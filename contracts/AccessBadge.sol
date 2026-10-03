// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IIssuerRegistry} from "./interfaces/IIssuerRegistry.sol";
import {ICredentialRegistry} from "./interfaces/ICredentialRegistry.sol";
import {IAccessBadge} from "./interfaces/IAccessBadge.sol";
import {IERC5192} from "./interfaces/IERC5192.sol";
contract AccessBadge is ERC1155, EIP712, IAccessBadge, IERC5192 {
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256("Attestation(address subject,uint8 tier,bytes32 credentialHash,uint64 expiry,uint256 nonce)");
    IIssuerRegistry public immutable issuerRegistry; ICredentialRegistry public immutable credentialRegistry;
    mapping(address => uint256) public nonces; mapping(address => uint8) private _badgeTier;
    error InvalidTier(); error InvalidSignature(); error Expired(); error NonceUsed(); error SoulboundTransfer(); error CredentialStillValid();
    constructor(address issuers, address credentials, string memory uri_) ERC1155(uri_) EIP712("GatedAccess", "1") { issuerRegistry = IIssuerRegistry(issuers); credentialRegistry = ICredentialRegistry(credentials); }
    function claim(Attestation calldata att, bytes calldata signature) external {
        if (att.tier < 1 || att.tier > 3) revert InvalidTier(); if (att.expiry <= block.timestamp) revert Expired();
        if (att.nonce != nonces[att.subject]) revert NonceUsed();
        bytes32 structHash = keccak256(abi.encode(ATTESTATION_TYPEHASH, att.subject, att.tier, att.credentialHash, att.expiry, att.nonce));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature); if (!issuerRegistry.isActive(signer)) revert InvalidSignature();
        unchecked { nonces[att.subject]++; }
        credentialRegistry.anchor(att.credentialHash, signer, att.subject, att.tier, att.expiry);
        uint8 oldTier = _badgeTier[att.subject]; if (oldTier != 0) _burn(att.subject, oldTier, 1);
        _badgeTier[att.subject] = att.tier; _mint(att.subject, att.tier, 1, ""); emit Locked(att.tier); emit BadgeClaimed(att.subject, att.tier, att.credentialHash);
    }
    function locked(uint256 tokenId) external pure returns (bool) { if (tokenId < 1 || tokenId > 3) revert InvalidTier(); return true; }
    function supportsInterface(bytes4 interfaceId) public view override(ERC1155) returns (bool) { return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId); }
    function tierOf(address account) public view returns (uint8) { uint8 tier = _badgeTier[account]; if (tier == 0 || balanceOf(account, tier) == 0) return 0; bytes32 hash = credentialRegistry.activeCredentialOf(account); return credentialRegistry.isValid(hash) ? tier : 0; }
    function hasValidTier(address account, uint8 minTier) external view returns (bool) { return tierOf(account) >= minTier; }
    function burnExpired(address account) external { if (tierOf(account) != 0) revert CredentialStillValid(); uint8 tier = _badgeTier[account]; if (tier != 0 && balanceOf(account, tier) != 0) _burn(account, tier, 1); _badgeTier[account] = 0; }
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override { if (from != address(0) && to != address(0)) revert SoulboundTransfer(); super._update(from, to, ids, values); }
}
