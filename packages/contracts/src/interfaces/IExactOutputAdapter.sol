// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Exact-output payment adapter interface
/// @notice Adapters pull `tokenIn` from the caller and send exactly
/// `exactAmountOut` of `tokenOut` to `recipient`.
/// @dev GiwaPay calls adapters with a normal external call. Proxy adapters are
/// intentionally unsupported because their runtime code hash is not a stable
/// description of the executed implementation.
interface IExactOutputAdapter {
    /// @notice Quotes the input needed to receive an exact output.
    function quoteExactOutput(address tokenIn, address tokenOut, uint256 exactAmountOut, bytes calldata data)
        external
        view
        returns (uint256 amountIn);

    /// @notice Swaps at most `maxAmountIn` for exactly `exactAmountOut`.
    /// @return amountIn The actual input consumed.
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 exactAmountOut,
        uint256 maxAmountIn,
        address recipient,
        bytes calldata data
    ) external payable returns (uint256 amountIn);
}
