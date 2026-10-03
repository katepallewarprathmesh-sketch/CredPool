// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

/// @notice Minimal Soulbound NFT interface (EIP-5192).
/// @dev CredPool exposes this interface for its ERC-1155 badge tier IDs so
/// wallets and indexers can discover that every badge class is locked.
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);

    function locked(uint256 tokenId) external view returns (bool);
}
