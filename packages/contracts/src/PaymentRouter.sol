// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IExactOutputAdapter} from "./interfaces/IExactOutputAdapter.sol";
import {IMerchantRegistry} from "./interfaces/IMerchantRegistry.sol";
import {IAdapterRegistry} from "./interfaces/IAdapterRegistry.sol";

/// @title GiwaPay non-custodial payment router
/// @notice Verifies merchant EIP-712 intents and atomically moves a payer's
/// input into an exact merchant settlement, platform fee and optional split.
/// Funds are never intentionally retained between transactions.
contract PaymentRouter is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant EIP712_NAME = "GiwaPay";
    string public constant EIP712_VERSION = "1";
    uint256 public constant BASIS_POINTS = 10_000;

    bytes32 public constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(bytes32 intentId,address merchant,address signer,address settlementToken,uint256 settlementAmount,bytes32 splitId,bytes32 splitHash,uint256 platformFee,uint48 validAfter,uint48 expiresAt,address payer,bytes32 metadataHash)"
    );

    struct PaymentIntent {
        bytes32 intentId;
        address merchant;
        address signer;
        address settlementToken;
        uint256 settlementAmount;
        bytes32 splitId;
        bytes32 splitHash;
        uint256 platformFee;
        uint48 validAfter;
        uint48 expiresAt;
        address payer;
        bytes32 metadataHash;
    }

    struct PaymentParams {
        address tokenIn;
        uint256 maxAmountIn;
        address adapter;
        bytes adapterData;
    }

    struct PaymentRecord {
        address merchant;
        address payer;
        address settlementToken;
        uint256 settlementAmount;
        uint256 platformFee;
        uint256 refundedAmount;
    }

    IMerchantRegistry public immutable merchantRegistry;
    IAdapterRegistry public immutable adapterRegistry;
    address public immutable platformFeeRecipient;
    uint16 public immutable platformFeeBps;

    mapping(address merchant => mapping(bytes32 intentId => bool used)) public usedIntents;
    mapping(address merchant => mapping(bytes32 intentId => mapping(bytes32 refundId => bool used))) public
        usedRefundIds;
    mapping(address merchant => mapping(bytes32 intentId => PaymentRecord record)) public paymentRecords;

    error ZeroAddress();
    error InvalidPlatformFeePolicy();
    error InvalidIntentId();
    error InvalidSettlementAmount();
    error MerchantInactive();
    error IntentNotYetValid();
    error IntentExpired();
    error InvalidIntentWindow();
    error IntentAlreadyUsed();
    error UnauthorizedPayer();
    error InvalidIntentSignature();
    error InvalidPlatformFee();
    error SplitUnavailable();
    error InvalidSplitTemplate();
    error InvalidSplitHash();
    error InvalidPaymentRoute();
    error MaximumInputExceeded();
    error SettlementTokenHasNoCode();
    error FeeOnTransferTokenUnsupported(address token);
    error ExactTransferFailed(address token, address recipient, uint256 expectedAmount);
    error AdapterReportedInvalidAmount();
    error AdapterInputAccountingMismatch();
    error AdapterOutputAccountingMismatch();
    error RouterRecipientForbidden();
    error PaymentNotFound();
    error UnauthorizedRefundOperator();
    error InvalidRefundId();
    error RefundIdAlreadyUsed();
    error InvalidRefundAmount();

    event PaymentSucceeded(
        bytes32 indexed intentId,
        address indexed merchant,
        address indexed payer,
        address tokenIn,
        address settlementToken,
        uint256 amountIn,
        uint256 merchantAmount,
        uint256 platformFee,
        bytes32 splitId,
        address adapter
    );
    event SettlementDistributed(
        bytes32 indexed intentId,
        address indexed merchant,
        address indexed recipient,
        address settlementToken,
        uint256 amount,
        uint16 basisPoints
    );
    event Refunded(
        bytes32 indexed intentId,
        bytes32 indexed refundId,
        address indexed merchant,
        address payer,
        address settlementToken,
        uint256 amount,
        uint256 totalRefunded,
        address operator
    );

    constructor(
        address initialOwner,
        IMerchantRegistry merchantRegistry_,
        IAdapterRegistry adapterRegistry_,
        address platformFeeRecipient_,
        uint16 platformFeeBps_
    ) EIP712(EIP712_NAME, EIP712_VERSION) Ownable(initialOwner) {
        if (
            address(merchantRegistry_) == address(0) || address(adapterRegistry_) == address(0)
                || platformFeeRecipient_ == address(0)
        ) revert ZeroAddress();
        if (platformFeeBps_ > BASIS_POINTS) revert InvalidPlatformFeePolicy();

        merchantRegistry = merchantRegistry_;
        adapterRegistry = adapterRegistry_;
        platformFeeRecipient = platformFeeRecipient_;
        platformFeeBps = platformFeeBps_;
    }

    /// @notice Executes either a direct-token or registered adapter payment.
    /// @dev Direct payments set `adapter` to zero and `tokenIn` equal to the
    /// signed settlement token. Adapter payments transfer `maxAmountIn`, consume
    /// only the measured input and atomically refund the remainder.
    function pay(PaymentIntent calldata intent, bytes calldata signature, PaymentParams calldata params)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 amountIn)
    {
        (address[] memory recipients, uint16[] memory basisPoints) = _validateIntent(intent, signature);

        uint256 exactOutput = intent.settlementAmount + intent.platformFee;

        // Effects precede all token and adapter interactions. Any failed
        // interaction reverts these writes with the transaction.
        usedIntents[intent.merchant][intent.intentId] = true;
        paymentRecords[intent.merchant][intent.intentId] = PaymentRecord({
            merchant: intent.merchant,
            payer: msg.sender,
            settlementToken: intent.settlementToken,
            settlementAmount: intent.settlementAmount,
            platformFee: intent.platformFee,
            refundedAmount: 0
        });

        if (params.adapter == address(0)) {
            amountIn = _collectDirect(intent.settlementToken, exactOutput, params);
        } else {
            amountIn = _collectThroughAdapter(intent, exactOutput, params);
        }

        _distributeSettlement(
            intent.intentId,
            intent.merchant,
            intent.settlementToken,
            intent.settlementAmount,
            intent.platformFee,
            recipients,
            basisPoints
        );

        emit PaymentSucceeded(
            intent.intentId,
            intent.merchant,
            msg.sender,
            params.tokenIn,
            intent.settlementToken,
            amountIn,
            intent.settlementAmount,
            intent.platformFee,
            intent.splitId,
            params.adapter
        );
    }

    /// @notice Issues a full or partial refund funded by the calling merchant
    /// admin or registered refund operator.
    /// @dev Platform fees are not silently clawed back. The merchant-controlled
    /// caller explicitly funds the requested settlement-token refund.
    function refund(address merchant, bytes32 intentId, bytes32 refundId, uint256 amount) external nonReentrant {
        PaymentRecord storage record = paymentRecords[merchant][intentId];
        if (record.merchant == address(0)) revert PaymentNotFound();
        if (!merchantRegistry.isAuthorizedRefundOperator(merchant, msg.sender)) {
            revert UnauthorizedRefundOperator();
        }
        if (refundId == bytes32(0)) revert InvalidRefundId();
        if (usedRefundIds[merchant][intentId][refundId]) revert RefundIdAlreadyUsed();
        if (amount == 0 || record.refundedAmount + amount > record.settlementAmount) revert InvalidRefundAmount();

        usedRefundIds[merchant][intentId][refundId] = true;
        record.refundedAmount += amount;

        IERC20 token = IERC20(record.settlementToken);
        uint256 routerBalanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - routerBalanceBefore != amount) {
            revert FeeOnTransferTokenUnsupported(record.settlementToken);
        }
        _transferExact(token, record.payer, amount);

        if (token.balanceOf(address(this)) != routerBalanceBefore) {
            revert ExactTransferFailed(record.settlementToken, record.payer, amount);
        }

        emit Refunded(
            intentId,
            refundId,
            record.merchant,
            record.payer,
            record.settlementToken,
            amount,
            record.refundedAmount,
            msg.sender
        );
    }

    /// @notice Returns the EIP-712 digest that the delegated signer authorizes.
    function hashPaymentIntent(PaymentIntent calldata intent) public view returns (bytes32) {
        return _hashTypedDataV4(_hashPaymentIntentStruct(intent));
    }

    /// @notice Returns the EIP-712 domain separator for client verification.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Emergency-stops new payments. Merchant-funded refunds remain
    /// available while paused.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes new payments.
    function unpause() external onlyOwner {
        _unpause();
    }

    function _validateIntent(PaymentIntent calldata intent, bytes calldata signature)
        private
        view
        returns (address[] memory recipients, uint16[] memory basisPoints)
    {
        if (intent.intentId == bytes32(0)) revert InvalidIntentId();
        if (intent.merchant == address(0) || intent.signer == address(0) || intent.settlementToken == address(0)) {
            revert ZeroAddress();
        }
        if (intent.settlementToken.code.length == 0) revert SettlementTokenHasNoCode();
        if (intent.settlementAmount == 0) revert InvalidSettlementAmount();
        if (intent.expiresAt <= intent.validAfter) revert InvalidIntentWindow();
        if (block.timestamp < intent.validAfter) revert IntentNotYetValid();
        if (block.timestamp > intent.expiresAt) revert IntentExpired();
        if (usedIntents[intent.merchant][intent.intentId]) revert IntentAlreadyUsed();
        if (intent.payer != address(0) && intent.payer != msg.sender) {
            revert UnauthorizedPayer();
        }

        IMerchantRegistry.Merchant memory merchant = merchantRegistry.getMerchant(intent.merchant);
        if (!merchant.active) revert MerchantInactive();

        uint256 requiredFee = Math.mulDiv(intent.settlementAmount, platformFeeBps, BASIS_POINTS, Math.Rounding.Ceil);
        if (intent.platformFee != requiredFee) revert InvalidPlatformFee();

        if (
            !merchantRegistry.isAuthorizedIntentSigner(intent.merchant, intent.signer)
                || !SignatureChecker.isValidSignatureNow(intent.signer, hashPaymentIntent(intent), signature)
        ) {
            revert InvalidIntentSignature();
        }

        bool enabled;
        (recipients, basisPoints, enabled) = merchantRegistry.getSplitTemplate(intent.merchant, intent.splitId);
        if (!enabled) revert SplitUnavailable();
        if (recipients.length == 0 || recipients.length != basisPoints.length || recipients.length > 8) {
            revert InvalidSplitTemplate();
        }

        uint256 totalBasisPoints = 0;
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0) || recipients[i] == address(this)) {
                revert RouterRecipientForbidden();
            }
            if (basisPoints[i] == 0) revert InvalidSplitTemplate();
            totalBasisPoints += basisPoints[i];
        }
        if (totalBasisPoints != BASIS_POINTS) revert InvalidSplitTemplate();
        if (keccak256(abi.encode(recipients, basisPoints)) != intent.splitHash) revert InvalidSplitHash();
        if (platformFeeRecipient == address(this)) revert RouterRecipientForbidden();
    }

    function _collectDirect(address settlementToken, uint256 exactOutput, PaymentParams calldata params)
        private
        returns (uint256 amountIn)
    {
        if (params.tokenIn != settlementToken || params.adapterData.length != 0) revert InvalidPaymentRoute();
        if (exactOutput > params.maxAmountIn) revert MaximumInputExceeded();

        IERC20 token = IERC20(settlementToken);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), exactOutput);
        if (token.balanceOf(address(this)) - balanceBefore != exactOutput) {
            revert FeeOnTransferTokenUnsupported(settlementToken);
        }
        return exactOutput;
    }

    function _collectThroughAdapter(PaymentIntent calldata intent, uint256 exactOutput, PaymentParams calldata params)
        private
        returns (uint256 amountIn)
    {
        if (
            params.tokenIn == address(0) || params.tokenIn == intent.settlementToken || params.tokenIn.code.length == 0
                || params.maxAmountIn == 0
        ) revert InvalidPaymentRoute();

        adapterRegistry.validateAdapter(params.adapter, params.tokenIn, intent.settlementToken, params.maxAmountIn);

        IERC20 inputToken = IERC20(params.tokenIn);
        IERC20 outputToken = IERC20(intent.settlementToken);

        uint256 inputBalanceBefore = inputToken.balanceOf(address(this));
        inputToken.safeTransferFrom(msg.sender, address(this), params.maxAmountIn);
        uint256 inputBalanceAfterPull = inputToken.balanceOf(address(this));
        if (inputBalanceAfterPull - inputBalanceBefore != params.maxAmountIn) {
            revert FeeOnTransferTokenUnsupported(params.tokenIn);
        }

        uint256 outputBalanceBefore = outputToken.balanceOf(address(this));
        inputToken.forceApprove(params.adapter, params.maxAmountIn);
        amountIn = IExactOutputAdapter(params.adapter)
            .swapExactOutput(
                params.tokenIn,
                intent.settlementToken,
                exactOutput,
                params.maxAmountIn,
                address(this),
                params.adapterData
            );
        inputToken.forceApprove(params.adapter, 0);

        if (amountIn == 0 || amountIn > params.maxAmountIn) {
            revert AdapterReportedInvalidAmount();
        }

        uint256 inputBalanceAfterSwap = inputToken.balanceOf(address(this));
        if (inputBalanceAfterSwap < inputBalanceBefore || inputBalanceAfterPull - inputBalanceAfterSwap != amountIn) {
            revert AdapterInputAccountingMismatch();
        }

        if (outputToken.balanceOf(address(this)) - outputBalanceBefore != exactOutput) {
            revert AdapterOutputAccountingMismatch();
        }

        uint256 refundAmount = params.maxAmountIn - amountIn;
        if (refundAmount != 0) {
            _transferExact(inputToken, msg.sender, refundAmount);
        }
        if (inputToken.balanceOf(address(this)) != inputBalanceBefore) {
            revert AdapterInputAccountingMismatch();
        }
    }

    function _distributeSettlement(
        bytes32 intentId,
        address merchant,
        address settlementToken,
        uint256 settlementAmount,
        uint256 platformFee,
        address[] memory recipients,
        uint16[] memory basisPoints
    ) private {
        IERC20 token = IERC20(settlementToken);
        uint256 remaining = settlementAmount;
        uint256 lastIndex = recipients.length - 1;

        for (uint256 i; i < recipients.length; ++i) {
            uint256 recipientAmount;
            if (i == lastIndex) {
                recipientAmount = remaining;
            } else {
                recipientAmount = Math.mulDiv(settlementAmount, basisPoints[i], BASIS_POINTS);
                remaining -= recipientAmount;
            }
            if (recipientAmount != 0) {
                _transferExact(token, recipients[i], recipientAmount);
            }
            emit SettlementDistributed(
                intentId, merchant, recipients[i], settlementToken, recipientAmount, basisPoints[i]
            );
        }

        if (platformFee != 0) {
            _transferExact(token, platformFeeRecipient, platformFee);
        }
    }

    function _transferExact(IERC20 token, address recipient, uint256 amount) private {
        if (recipient == address(this)) revert RouterRecipientForbidden();
        uint256 recipientBalanceBefore = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (token.balanceOf(recipient) - recipientBalanceBefore != amount) {
            revert ExactTransferFailed(address(token), recipient, amount);
        }
    }

    function _hashPaymentIntentStruct(PaymentIntent calldata intent) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                intent.intentId,
                intent.merchant,
                intent.signer,
                intent.settlementToken,
                intent.settlementAmount,
                intent.splitId,
                intent.splitHash,
                intent.platformFee,
                intent.validAfter,
                intent.expiresAt,
                intent.payer,
                intent.metadataHash
            )
        );
    }
}
