// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAccessBadge} from "./interfaces/IAccessBadge.sol";
import {GatedLP} from "./GatedLP.sol";

contract GatedPool is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address private constant LOCK = address(0xdead);

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    IAccessBadge public immutable badge;
    GatedLP public immutable lpToken;
    uint256 public reserve0;
    uint256 public reserve1;
    uint16 public feeBps = 30;
    uint64 public constant VOLUME_WINDOW = 1 days;
    mapping(uint8 => uint256) public tierLimits;
    struct VolumeWindow { uint64 startedAt; uint192 used; }
    mapping(address => VolumeWindow) public volumeWindows;

    error NotVerified(uint8 requiredTier);
    error Expired();
    error Slippage();
    error LimitExceeded();
    error InsufficientLiquidity();
    error InvalidToken();
    error InvalidFee();
    error InvalidAmount();
    error FeeOnTransferUnsupported();

    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);
    event LiquidityAdded(address indexed user, uint256 amount0, uint256 amount1, uint256 shares);
    event LiquidityRemoved(address indexed user, uint256 amount0, uint256 amount1, uint256 shares);
    event FeeUpdated(uint16 feeBps);
    event TierLimitUpdated(uint8 tier, uint256 maxSwap);

    constructor(address token0_, address token1_, address badge_, address admin) {
        if (token0_ == address(0) || token1_ == address(0) || token0_ == token1_ || badge_ == address(0)) {
            revert InvalidToken();
        }
        token0 = IERC20(token0_);
        token1 = IERC20(token1_);
        badge = IAccessBadge(badge_);
        lpToken = new GatedLP();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        tierLimits[1] = 1_000 ether;
        tierLimits[2] = 50_000 ether;
    }

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    modifier onlyVerified(uint8 minTier) {
        if (!badge.hasValidTier(msg.sender, minTier)) revert NotVerified(minTier);
        _;
    }

    function setFee(uint16 value) external onlyRole(ADMIN_ROLE) {
        if (value < 1 || value > 100) revert InvalidFee();
        feeBps = value;
        emit FeeUpdated(value);
    }

    function setTierLimit(uint8 tier, uint256 maxSwap) external onlyRole(ADMIN_ROLE) {
        if (tier < 1 || tier > 3 || maxSwap > type(uint192).max) revert InvalidAmount();
        tierLimits[tier] = maxSwap;
        emit TierLimitUpdated(tier, maxSwap);
    }

    function pause() external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }

    function addLiquidity(uint256 a0d, uint256 a1d, uint256 a0min, uint256 a1min, uint256 deadline)
        external nonReentrant whenNotPaused onlyVerified(2) beforeDeadline(deadline) returns (uint256 shares)
    {
        if (a0d == 0 || a1d == 0) revert InvalidAmount();
        uint256 a0;
        uint256 a1;
        uint256 supply = lpToken.totalSupply();
        if (supply == 0) {
            a0 = a0d;
            a1 = a1d;
        } else {
            uint256 optimal1 = Math.mulDiv(a0d, reserve1, reserve0);
            if (optimal1 <= a1d) {
                a0 = a0d;
                a1 = optimal1;
            } else {
                a0 = Math.mulDiv(a1d, reserve0, reserve1);
                a1 = a1d;
            }
        }
        if (a0 < a0min || a1 < a1min) revert Slippage();
        _pullExact(token0, a0);
        _pullExact(token1, a1);
        if (supply == 0) {
            uint256 root = Math.sqrt(a0 * a1);
            if (root <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            shares = root - MINIMUM_LIQUIDITY;
        } else {
            shares = Math.min(Math.mulDiv(a0, supply, reserve0), Math.mulDiv(a1, supply, reserve1));
        }
        if (shares == 0) revert InsufficientLiquidity();
        reserve0 += a0;
        reserve1 += a1;
        if (supply == 0) lpToken.mint(LOCK, MINIMUM_LIQUIDITY);
        lpToken.mint(msg.sender, shares);
        emit LiquidityAdded(msg.sender, a0, a1, shares);
    }

    function removeLiquidity(uint256 shares, uint256 a0min, uint256 a1min, uint256 deadline)
        external nonReentrant onlyVerified(2) beforeDeadline(deadline) returns (uint256 a0, uint256 a1)
    {
        if (shares == 0) revert InvalidAmount();
        uint256 supply = lpToken.totalSupply();
        a0 = Math.mulDiv(shares, reserve0, supply);
        a1 = Math.mulDiv(shares, reserve1, supply);
        if (a0 < a0min || a1 < a1min) revert Slippage();
        if (a0 == 0 || a1 == 0) revert InsufficientLiquidity();
        reserve0 -= a0;
        reserve1 -= a1;
        lpToken.burn(msg.sender, shares);
        token0.safeTransfer(msg.sender, a0);
        token1.safeTransfer(msg.sender, a1);
        emit LiquidityRemoved(msg.sender, a0, a1, shares);
    }

    function getAmountOut(address input, uint256 amountIn) public view returns (uint256) {
        if (amountIn == 0) revert InvalidAmount();
        bool zero = input == address(token0);
        if (!zero && input != address(token1)) revert InvalidToken();
        uint256 rIn = zero ? reserve0 : reserve1;
        uint256 rOut = zero ? reserve1 : reserve0;
        if (rIn == 0 || rOut == 0) revert InsufficientLiquidity();
        uint256 amountWithFee = amountIn * (10_000 - feeBps);
        return Math.mulDiv(amountWithFee, rOut, rIn * 10_000 + amountWithFee);
    }

    function swap(address input, uint256 amountIn, uint256 minOut, uint256 deadline)
        external nonReentrant whenNotPaused beforeDeadline(deadline) returns (uint256 out)
    {
        uint8 tier = badge.tierOf(msg.sender);
        if (tier < 1) revert NotVerified(1);
        return _swap(input, amountIn, minOut, tier);
    }

    /// @notice Executes permit and swap atomically for EIP-2612-compatible input tokens.
    function swapWithPermit(
        address input,
        uint256 amountIn,
        uint256 minOut,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused beforeDeadline(deadline) returns (uint256 out) {
        uint8 tier = badge.tierOf(msg.sender);
        if (tier < 1) revert NotVerified(1);
        IERC20Permit(input).permit(msg.sender, address(this), amountIn, deadline, v, r, s);
        return _swap(input, amountIn, minOut, tier);
    }

    function remainingVolume(address account) external view returns (uint256) {
        uint8 tier = badge.tierOf(account);
        if (tier == 3) return type(uint256).max;
        uint256 limit = tierLimits[tier];
        VolumeWindow memory window = volumeWindows[account];
        if (block.timestamp >= uint256(window.startedAt) + VOLUME_WINDOW) return limit;
        return uint256(window.used) >= limit ? 0 : limit - uint256(window.used);
    }

    function _swap(address input, uint256 amountIn, uint256 minOut, uint8 tier) private returns (uint256 out) {
        uint256 equiv;
        if (input == address(token0)) {
            equiv = amountIn;
        } else if (reserve1 == 0) {
            equiv = type(uint256).max;
        } else {
            equiv = Math.mulDiv(amountIn, reserve0, reserve1);
        }
        if (tier < 3) {
            uint256 limit = tierLimits[tier];
            VolumeWindow memory window = volumeWindows[msg.sender];
            if (block.timestamp >= uint256(window.startedAt) + VOLUME_WINDOW) {
                window.startedAt = uint64(block.timestamp);
                window.used = 0;
            }
            uint256 nextUsed = uint256(window.used) + equiv;
            if (limit == 0 || nextUsed > limit) revert LimitExceeded();
            window.used = uint192(nextUsed);
            volumeWindows[msg.sender] = window;
        }
        out = getAmountOut(input, amountIn);
        if (out < minOut) revert Slippage();
        bool zero = input == address(token0);
        IERC20 inToken = zero ? token0 : token1;
        IERC20 outToken = zero ? token1 : token0;
        _pullExact(inToken, amountIn);
        if (zero) {
            reserve0 += amountIn;
            reserve1 -= out;
        } else {
            reserve1 += amountIn;
            reserve0 -= out;
        }
        outToken.safeTransfer(msg.sender, out);
        emit Swap(msg.sender, input, amountIn, out);
    }

    function _pullExact(IERC20 token, uint256 amount) private {
        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBal != amount) revert FeeOnTransferUnsupported();
    }
}
