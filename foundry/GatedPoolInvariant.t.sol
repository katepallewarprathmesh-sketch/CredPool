// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GatedPool} from "../contracts/GatedPool.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {IAccessBadge} from "../contracts/interfaces/IAccessBadge.sol";

contract AlwaysInstitutionalBadge is IAccessBadge {
    function claim(Attestation calldata, bytes calldata) external pure {
        revert();
    }
    function burnExpired(address) external pure {
        revert();
    }
    function tierOf(address) external pure returns (uint8) {
        return 3;
    }
    function hasValidTier(address, uint8) external pure returns (bool) {
        return true;
    }
    function nonces(address) external pure returns (uint256) {
        return 0;
    }
}

contract SwapHandler {
    GatedPool public immutable pool;
    MockERC20 public immutable token0;
    MockERC20 public immutable token1;

    constructor(GatedPool pool_, MockERC20 token0_, MockERC20 token1_) {
        pool = pool_;
        token0 = token0_;
        token1 = token1_;
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
    }

    function swap0(uint96 raw) external {
        uint256 amount = (uint256(raw) % 1_000 ether) + 1;
        if (token0.balanceOf(address(this)) < amount) token0.mint(address(this), amount);
        try pool.swap(address(token0), amount, 0, block.timestamp) {} catch {}
    }

    function swap1(uint96 raw) external {
        uint256 amount = (uint256(raw) % 1_000 ether) + 1;
        if (token1.balanceOf(address(this)) < amount) token1.mint(address(this), amount);
        try pool.swap(address(token1), amount, 0, block.timestamp) {} catch {}
    }
}

contract GatedPoolInvariantTest {
    address[] internal invariantTargets;
    MockERC20 internal token0;
    MockERC20 internal token1;
    GatedPool internal pool;
    SwapHandler internal handler;
    uint256 internal initialK;

    function setUp() public {
        token0 = new MockERC20("Invariant A", "IA");
        token1 = new MockERC20("Invariant B", "IB");
        AlwaysInstitutionalBadge badge = new AlwaysInstitutionalBadge();
        pool = new GatedPool(address(token0), address(token1), address(badge), address(this));
        token0.mint(address(this), 1_000_000 ether);
        token1.mint(address(this), 1_000_000 ether);
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
        pool.addLiquidity(1_000_000 ether, 1_000_000 ether, 0, 0, block.timestamp);
        initialK = pool.reserve0() * pool.reserve1();
        handler = new SwapHandler(pool, token0, token1);
        invariantTargets.push(address(handler));
    }

    function targetContracts() public view returns (address[] memory) {
        return invariantTargets;
    }

    function invariant_constantProductNeverDecreases() public view {
        require(pool.reserve0() * pool.reserve1() >= initialK, "k decreased");
    }

    function invariant_recordedReservesAreFullyBacked() public view {
        require(token0.balanceOf(address(pool)) >= pool.reserve0(), "token0 undercollateralized");
        require(token1.balanceOf(address(pool)) >= pool.reserve1(), "token1 undercollateralized");
    }

    function testFuzz_quoteIsPositiveAndBelowReserve(uint96 raw) public view {
        uint256 amount = (uint256(raw) % 1_000 ether) + 1e12;
        uint256 quote = pool.getAmountOut(address(token0), amount);
        require(quote > 0 && quote < pool.reserve1(), "invalid quote");
    }
}
