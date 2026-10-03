// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
interface IPool {
    function swap(address, uint256, uint256, uint256) external returns (uint256);
}
contract ReentrantToken is ERC20 {
    address public pool;
    bool public attack;
    constructor() ERC20("Reentrant", "RE") {}
    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
    function configure(address p, bool a) external {
        pool = p;
        attack = a;
    }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (attack && msg.sender == pool) {
            attack = false;
            try IPool(pool).swap(address(this), 1, 0, block.timestamp) {} catch {}
        }
        return super.transferFrom(from, to, value);
    }
}
