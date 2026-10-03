// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract GatedLP is ERC20 {
    address public immutable pool; error OnlyPool();
    constructor() ERC20("Gated LP", "GLP") { pool = msg.sender; }
    function mint(address to, uint256 amount) external { if (msg.sender != pool) revert OnlyPool(); _mint(to, amount); }
    function burn(address from, uint256 amount) external { if (msg.sender != pool) revert OnlyPool(); _burn(from, amount); }
}
