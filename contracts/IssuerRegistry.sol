// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIssuerRegistry} from "./interfaces/IIssuerRegistry.sol";
contract IssuerRegistry is AccessControl, IIssuerRegistry {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ISSUER_GUARDIAN_ROLE = keccak256("ISSUER_GUARDIAN_ROLE");
    mapping(address => Issuer) private _issuers;
    error InvalidIssuer();
    constructor(address admin) {
        if (admin == address(0)) revert InvalidIssuer();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(ISSUER_GUARDIAN_ROLE, admin);
    }
    function addIssuer(address signer, string calldata name) external onlyRole(ADMIN_ROLE) {
        if (signer == address(0) || bytes(name).length == 0) revert InvalidIssuer();
        Issuer storage issuer = _issuers[signer];
        if (issuer.addedAt == 0) {
            _issuers[signer] = Issuer(name, true, uint64(block.timestamp));
            emit IssuerAdded(signer, name);
        } else {
            issuer.name = name;
            issuer.active = true;
            emit IssuerUpdated(signer, name, true);
        }
    }
    function removeIssuer(address signer) external onlyRole(ISSUER_GUARDIAN_ROLE) {
        _issuers[signer].active = false;
        emit IssuerRemoved(signer);
    }
    function isActive(address signer) external view returns (bool) {
        return _issuers[signer].active;
    }
    function getIssuer(address signer) external view returns (Issuer memory) {
        return _issuers[signer];
    }
}
