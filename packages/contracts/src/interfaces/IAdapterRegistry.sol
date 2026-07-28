// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IAdapterRegistry {
    function validateAdapter(address adapter, address tokenIn, address tokenOut, uint256 maxAmountIn) external view;
}
