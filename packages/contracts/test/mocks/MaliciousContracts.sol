// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IExactOutputAdapter} from "../../src/interfaces/IExactOutputAdapter.sol";

contract TestERC1271Signer is IERC1271 {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(hash, signature) == owner ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

contract FeeOnTransferToken is ERC20 {
    uint256 public constant FEE_BPS = 100;

    constructor() ERC20("Malicious Fee Token", "FEE") {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * FEE_BPS) / 10_000;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

contract SenderFeeToken is ERC20 {
    address public taxedSender;

    constructor() ERC20("Malicious Sender Fee Token", "SFEE") {}

    function setTaxedSender(address sender) external {
        taxedSender = sender;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == taxedSender && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

contract LyingExactOutputAdapter is IExactOutputAdapter {
    using SafeERC20 for IERC20;

    function quoteExactOutput(address, address, uint256 exactAmountOut, bytes calldata)
        external
        pure
        returns (uint256)
    {
        return exactAmountOut;
    }

    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 exactAmountOut,
        uint256 maxAmountIn,
        address recipient,
        bytes calldata
    ) external payable returns (uint256 amountIn) {
        amountIn = maxAmountIn / 2;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, exactAmountOut);
        return 1;
    }
}

contract ShortOutputAdapter is IExactOutputAdapter {
    using SafeERC20 for IERC20;

    function quoteExactOutput(address, address, uint256 exactAmountOut, bytes calldata)
        external
        pure
        returns (uint256)
    {
        return exactAmountOut;
    }

    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 exactAmountOut,
        uint256 maxAmountIn,
        address recipient,
        bytes calldata
    ) external payable returns (uint256 amountIn) {
        amountIn = maxAmountIn / 2;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, exactAmountOut - 1);
    }
}

contract ReentrantExactOutputAdapter is IExactOutputAdapter {
    using SafeERC20 for IERC20;

    address public immutable router;
    bytes private _reentrantCall;
    bool public reentryBlocked;

    constructor(address router_) {
        router = router_;
    }

    function setReentrantCall(bytes calldata callData) external {
        _reentrantCall = callData;
    }

    function quoteExactOutput(address, address, uint256 exactAmountOut, bytes calldata)
        external
        pure
        returns (uint256)
    {
        return exactAmountOut;
    }

    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 exactAmountOut,
        uint256,
        address recipient,
        bytes calldata
    ) external payable returns (uint256 amountIn) {
        (bool success,) = router.call(_reentrantCall);
        reentryBlocked = !success;

        amountIn = exactAmountOut;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, exactAmountOut);
    }
}
