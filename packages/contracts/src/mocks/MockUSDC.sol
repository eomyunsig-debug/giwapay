// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockMintableERC20} from "./MockMintableERC20.sol";

/// @title MockUSDC
/// @notice Testnet-only demo asset. It is not issued by or redeemable through
/// Circle and must never be displayed as production USDC.
contract MockUSDC is MockMintableERC20 {
    constructor(address initialAdmin) MockMintableERC20("GiwaPay Testnet Mock USDC", "MockUSDC", 6, initialAdmin) {}
}
