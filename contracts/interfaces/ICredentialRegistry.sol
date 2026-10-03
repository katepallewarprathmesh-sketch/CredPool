// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface ICredentialRegistry {
    struct Credential { address issuer; address subject; uint8 tier; uint64 expiry; bool revoked; }
    event CredentialAnchored(bytes32 indexed hash, address indexed subject, address indexed issuer, uint8 tier, uint64 expiry);
    event CredentialRevoked(bytes32 indexed hash, address indexed by);
    function anchor(bytes32 hash, address issuer, address subject, uint8 tier, uint64 expiry) external;
    function revoke(bytes32 hash) external;
    function isValid(bytes32 hash) external view returns (bool);
    function activeCredentialOf(address subject) external view returns (bytes32);
    function get(bytes32 hash) external view returns (Credential memory);
}
