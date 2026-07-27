// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IExactOutputAdapter} from "../interfaces/IExactOutputAdapter.sol";

/// @title Fixed-rate exact-output test adapter
/// @notice Deterministic, inventory-funded adapter for local and testnet demos.
/// It is not a production DEX and must be registered with `testOnly=true`.
contract MockFixedRateExactOutputAdapter is IExactOutputAdapter, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Rate {
        uint128 inputNumerator;
        uint128 outputDenominator;
        bool enabled;
    }

    mapping(bytes32 pairKey => Rate rate) public rates;

    error ZeroAddress();
    error InvalidPair();
    error InvalidRate();
    error PairNotConfigured();
    error UnsupportedAdapterData();
    error MaximumInputExceeded();
    error NativeValueUnsupported();

    event RateConfigured(
        address indexed tokenIn,
        address indexed tokenOut,
        uint128 inputNumerator,
        uint128 outputDenominator,
        bool enabled
    );
    event ExactOutputSwap(
        address indexed caller,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 exactAmountOut,
        address recipient
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Sets the raw-unit exchange rate. For example, numerator=2 and
    /// denominator=1 requires two tokenIn units per tokenOut unit.
    function setRate(address tokenIn, address tokenOut, uint128 inputNumerator, uint128 outputDenominator, bool enabled)
        external
        onlyOwner
    {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (tokenIn == tokenOut) revert InvalidPair();
        if (enabled && (inputNumerator == 0 || outputDenominator == 0)) {
            revert InvalidRate();
        }
        rates[_pairKey(tokenIn, tokenOut)] =
            Rate({inputNumerator: inputNumerator, outputDenominator: outputDenominator, enabled: enabled});
        emit RateConfigured(tokenIn, tokenOut, inputNumerator, outputDenominator, enabled);
    }

    /// @inheritdoc IExactOutputAdapter
    function quoteExactOutput(address tokenIn, address tokenOut, uint256 exactAmountOut, bytes calldata data)
        public
        view
        returns (uint256 amountIn)
    {
        if (data.length != 0) revert UnsupportedAdapterData();
        Rate memory rate = rates[_pairKey(tokenIn, tokenOut)];
        if (!rate.enabled) revert PairNotConfigured();
        return Math.mulDiv(exactAmountOut, rate.inputNumerator, rate.outputDenominator, Math.Rounding.Ceil);
    }

    /// @inheritdoc IExactOutputAdapter
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 exactAmountOut,
        uint256 maxAmountIn,
        address recipient,
        bytes calldata data
    ) external payable nonReentrant returns (uint256 amountIn) {
        if (msg.value != 0) revert NativeValueUnsupported();
        if (recipient == address(0)) revert ZeroAddress();
        amountIn = quoteExactOutput(tokenIn, tokenOut, exactAmountOut, data);
        if (amountIn > maxAmountIn) revert MaximumInputExceeded();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, exactAmountOut);

        emit ExactOutputSwap(msg.sender, tokenIn, tokenOut, amountIn, exactAmountOut, recipient);
    }

    /// @notice Recovers native currency forcibly sent to this test-only
    /// inventory contract. Normal swaps reject all native value.
    function withdrawForcedNative(address payable recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        Address.sendValue(recipient, address(this).balance);
    }

    function _pairKey(address tokenIn, address tokenOut) private pure returns (bytes32) {
        return keccak256(abi.encode(tokenIn, tokenOut));
    }
}
