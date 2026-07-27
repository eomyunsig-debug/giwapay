// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockMintableERC20} from "./MockMintableERC20.sol";

/// @title MockKRW
/// @notice Testnet-only KRW-denominated demo token. This contract does not
/// represent an official KRW stablecoin and carries no redemption promise.
contract MockKRW is MockMintableERC20 {
    constructor(address initialAdmin) MockMintableERC20("GiwaPay Testnet Mock KRW", "MockKRW", 6, initialAdmin) {}
}
