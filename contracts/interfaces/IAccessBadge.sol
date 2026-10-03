// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IAccessBadge {
    struct Attestation {
        address subject;
        uint8 tier;
        bytes32 credentialHash;
        uint64 expiry;
        uint256 nonce;
    }
    event BadgeClaimed(address indexed subject, uint8 tier, bytes32 credentialHash);
    function claim(Attestation calldata att, bytes calldata signature) external;
    function burnExpired(address account) external;
    function tierOf(address account) external view returns (uint8);
    function hasValidTier(address account, uint8 minTier) external view returns (bool);
    function nonces(address subject) external view returns (uint256);
}
