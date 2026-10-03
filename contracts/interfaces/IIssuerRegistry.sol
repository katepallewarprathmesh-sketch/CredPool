// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IIssuerRegistry {
    struct Issuer {
        string name;
        bool active;
        uint64 addedAt;
    }
    event IssuerAdded(address indexed signer, string name);
    event IssuerRemoved(address indexed signer);
    event IssuerUpdated(address indexed signer, string name, bool active);
    function addIssuer(address signer, string calldata name) external;
    function removeIssuer(address signer) external;
    function isActive(address signer) external view returns (bool);
    function getIssuer(address signer) external view returns (Issuer memory);
}
