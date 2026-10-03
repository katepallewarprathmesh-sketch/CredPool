// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GatedPool} from "../contracts/GatedPool.sol";
import {GatedLP} from "../contracts/GatedLP.sol";
import {AccessBadge} from "../contracts/AccessBadge.sol";
import {IssuerRegistry} from "../contracts/IssuerRegistry.sol";
import {CredentialRegistry} from "../contracts/CredentialRegistry.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {IAccessBadge} from "../contracts/interfaces/IAccessBadge.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8, bytes32, bytes32);
}

contract TierBadge is IAccessBadge {
    mapping(address => uint8) public tiers;

    function setTier(address account, uint8 tier) external {
        tiers[account] = tier;
    }
    function claim(Attestation calldata, bytes calldata) external pure {
        revert();
    }
    function burnExpired(address) external pure {
        revert();
    }
    function tierOf(address account) external view returns (uint8) {
        return tiers[account];
    }
    function hasValidTier(address account, uint8 tier) external view returns (bool) {
        return tiers[account] >= tier;
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

contract UnverifiedHandler {
    GatedPool public immutable pool;
    MockERC20 public immutable token0;

    constructor(GatedPool pool_, MockERC20 token0_) {
        pool = pool_;
        token0 = token0_;
        token0.approve(address(pool), type(uint256).max);
    }

    function attemptSwap(uint96 raw) external {
        uint256 amount = (uint256(raw) % 1_000 ether) + 1;
        token0.mint(address(this), amount);
        uint256 reserve0 = pool.reserve0();
        uint256 reserve1 = pool.reserve1();
        try pool.swap(address(token0), amount, 0, block.timestamp) {
            revert("unverified swap succeeded");
        } catch {}
        require(pool.reserve0() == reserve0 && pool.reserve1() == reserve1, "reserves changed");
    }
}

contract GatedPoolInvariantTest {
    address private constant LOCK = address(0xdead);
    address[] internal invariantTargets;
    MockERC20 internal token0;
    MockERC20 internal token1;
    TierBadge internal badge;
    GatedPool internal pool;
    SwapHandler internal handler;
    UnverifiedHandler internal unverified;
    uint256 internal initialK;

    function setUp() public {
        token0 = new MockERC20("Invariant A", "IA");
        token1 = new MockERC20("Invariant B", "IB");
        badge = new TierBadge();
        badge.setTier(address(this), 3);
        pool = new GatedPool(address(token0), address(token1), address(badge), address(this));
        token0.mint(address(this), 2_000_000 ether);
        token1.mint(address(this), 2_000_000 ether);
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
        pool.addLiquidity(1_000_000 ether, 1_000_000 ether, 0, 0, block.timestamp);
        initialK = pool.reserve0() * pool.reserve1();
        handler = new SwapHandler(pool, token0, token1);
        unverified = new UnverifiedHandler(pool, token0);
        badge.setTier(address(handler), 3);
        invariantTargets.push(address(handler));
        invariantTargets.push(address(unverified));
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

    function invariant_lpSupplyIsFullyAccountedFor() public view {
        GatedLP lp = pool.lpToken();
        uint256 accounted = lp.balanceOf(address(this)) + lp.balanceOf(LOCK);
        require(lp.totalSupply() == accounted, "LP supply mismatch");
    }

    function testFuzz_quoteMatchesExecution(uint96 raw) public {
        uint256 amount = (uint256(raw) % 1_000 ether) + 1e12;
        token0.mint(address(this), amount);
        uint256 quote = pool.getAmountOut(address(token0), amount);
        uint256 beforeBalance = token1.balanceOf(address(this));
        uint256 out = pool.swap(address(token0), amount, 0, block.timestamp);
        require(out == quote, "return differs from quote");
        require(
            token1.balanceOf(address(this)) - beforeBalance == quote,
            "transfer differs from quote"
        );
    }

    function testFuzz_addThenRemoveNeverFavorsUser(uint96 raw) public {
        uint256 amount = (uint256(raw) % 10_000 ether) + 1e12;
        token0.mint(address(this), amount);
        token1.mint(address(this), amount);
        uint256 shares = pool.addLiquidity(amount, amount, 0, 0, block.timestamp);
        (uint256 returned0, uint256 returned1) = pool.removeLiquidity(
            shares,
            0,
            0,
            block.timestamp
        );
        require(returned0 <= amount && returned1 <= amount, "rounding favored user");
    }
}

contract AccessBadgeSignatureFuzzTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ISSUER_KEY = 0xA11CE;
    bytes32 private constant TYPEHASH =
        keccak256(
            "Attestation(address subject,uint8 tier,bytes32 credentialHash,uint64 expiry,uint256 nonce)"
        );

    function digest(
        AccessBadge badge,
        IAccessBadge.Attestation memory att,
        uint256 chainId
    ) private view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("GatedAccess")),
                keccak256(bytes("1")),
                chainId,
                address(badge)
            )
        );
        bytes32 value = keccak256(
            abi.encode(TYPEHASH, att.subject, att.tier, att.credentialHash, att.expiry, att.nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, value));
    }

    function signature(bytes32 value) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ISSUER_KEY, value);
        return abi.encodePacked(r, s, v);
    }

    function fixture() private returns (AccessBadge badge) {
        IssuerRegistry issuers = new IssuerRegistry(address(this));
        issuers.addIssuer(vm.addr(ISSUER_KEY), "Foundry issuer");
        CredentialRegistry credentials = new CredentialRegistry(address(issuers), address(this));
        badge = new AccessBadge(address(issuers), address(credentials), "ipfs://tiers/");
        credentials.grantRole(credentials.BADGE_ROLE(), address(badge));
    }

    function testFuzz_rejectsReusedNonce(bytes32 credentialHash) public {
        AccessBadge badge = fixture();
        IAccessBadge.Attestation memory att = IAccessBadge.Attestation({
            subject: vm.addr(0xB0B),
            tier: 1,
            credentialHash: credentialHash == bytes32(0) ? bytes32(uint256(1)) : credentialHash,
            expiry: uint64(block.timestamp + 1 days),
            nonce: 0
        });
        bytes memory sig = signature(digest(badge, att, block.chainid));
        badge.claim(att, sig);
        try badge.claim(att, sig) {
            revert("reused nonce accepted");
        } catch {}
    }

    function testFuzz_rejectsWrongDomain(bytes32 credentialHash, uint32 wrongChain) public {
        AccessBadge badge = fixture();
        IAccessBadge.Attestation memory att = IAccessBadge.Attestation({
            subject: vm.addr(0xB0B),
            tier: 1,
            credentialHash: credentialHash == bytes32(0) ? bytes32(uint256(1)) : credentialHash,
            expiry: uint64(block.timestamp + 1 days),
            nonce: 0
        });
        uint256 chainId = uint256(wrongChain) + 1;
        if (chainId == block.chainid) chainId++;
        try badge.claim(att, signature(digest(badge, att, chainId))) {
            revert("wrong domain accepted");
        } catch {}
    }
}
