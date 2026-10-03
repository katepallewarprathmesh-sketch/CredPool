// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIssuerRegistry} from "./interfaces/IIssuerRegistry.sol";
import {ICredentialRegistry} from "./interfaces/ICredentialRegistry.sol";
contract CredentialRegistry is AccessControl, ICredentialRegistry {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant BADGE_ROLE = keccak256("BADGE_ROLE");
    IIssuerRegistry public immutable issuerRegistry;
    mapping(bytes32 => Credential) private _credentials;
    mapping(address => bytes32) private _active;
    error AlreadyAnchored(); error UnknownCredential(); error Unauthorized(); error InvalidCredential();
    constructor(address issuers, address admin) { if (issuers == address(0) || admin == address(0)) revert InvalidCredential(); issuerRegistry = IIssuerRegistry(issuers); _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(ADMIN_ROLE, admin); }
    function anchor(bytes32 hash, address issuer, address subject, uint8 tier, uint64 expiry) external onlyRole(BADGE_ROLE) {
        if (_credentials[hash].issuer != address(0)) revert AlreadyAnchored();
        if (hash == bytes32(0) || issuer == address(0) || subject == address(0) || tier < 1 || tier > 3 || expiry <= block.timestamp) revert InvalidCredential();
        _credentials[hash] = Credential(issuer, subject, tier, expiry, false); _active[subject] = hash;
        emit CredentialAnchored(hash, subject, issuer, tier, expiry);
    }
    function revoke(bytes32 hash) external {
        Credential storage c = _credentials[hash]; if (c.issuer == address(0)) revert UnknownCredential();
        if (msg.sender != c.issuer && !hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        c.revoked = true; emit CredentialRevoked(hash, msg.sender);
    }
    function isValid(bytes32 hash) public view returns (bool) { Credential storage c = _credentials[hash]; return c.issuer != address(0) && !c.revoked && c.expiry > block.timestamp && issuerRegistry.isActive(c.issuer) && _active[c.subject] == hash; }
    function activeCredentialOf(address subject) external view returns (bytes32) { return _active[subject]; }
    function get(bytes32 hash) external view returns (Credential memory) { return _credentials[hash]; }
}
