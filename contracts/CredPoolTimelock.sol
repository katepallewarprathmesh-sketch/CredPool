// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Governance delay used between the admin multisig and CredPool contracts.
contract CredPoolTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address bootstrapAdmin
    ) TimelockController(minDelay, proposers, executors, bootstrapAdmin) {}
}
