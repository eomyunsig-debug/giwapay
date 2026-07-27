// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockMintableERC20} from "./MockMintableERC20.sol";

/// @title MockALT
/// @notice Testnet-only volatile input asset for exact-output adapter demos.
contract MockALT is MockMintableERC20 {
    constructor(address initialAdmin) MockMintableERC20("GiwaPay Testnet Mock ALT", "MockALT", 18, initialAdmin) {}
}
