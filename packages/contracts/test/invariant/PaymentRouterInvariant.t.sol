// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PaymentTestBase} from "../PaymentTestBase.sol";
import {PaymentRouter} from "../../src/PaymentRouter.sol";
import {MockKRW} from "../../src/mocks/MockKRW.sol";

contract PaymentRouterHandler is Test {
    uint16 private constant FEE_BPS = 100;
    bytes32 private constant SETTLEMENT_DISTRIBUTED_TOPIC =
        keccak256("SettlementDistributed(bytes32,address,address,address,uint256,uint16)");

    PaymentRouter public immutable router;
    MockKRW public immutable token;
    address public immutable merchant;
    address public immutable payout;
    address public immutable signer;
    uint256 public immutable signerPrivateKey;

    bytes32[] private _intentIds;
    mapping(bytes32 intentId => bytes callData) private _paymentCalls;
    uint256 public initialBalance;
    uint256 public totalPaid;
    uint256 public totalPlatformFees;
    uint256 public totalRefunded;
    uint256 public replaySuccesses;
    uint256 public distributionEventMismatches;

    constructor(PaymentRouter router_, MockKRW token_, address merchant_, address payout_, uint256 signerPrivateKey_) {
        router = router_;
        token = token_;
        merchant = merchant_;
        payout = payout_;
        signerPrivateKey = signerPrivateKey_;
        signer = vm.addr(signerPrivateKey_);
        token_.approve(address(router_), type(uint256).max);
    }

    function snapshotInitialBalance() external {
        require(initialBalance == 0, "initial balance already set");
        initialBalance = token.balanceOf(address(this));
    }

    function payDirect(uint96 rawAmount) external {
        uint256 amount = (uint256(rawAmount) % (1_000_000 * 1e6)) + 1;
        uint256 fee = Math.mulDiv(amount, FEE_BPS, 10_000, Math.Rounding.Ceil);
        if (token.balanceOf(address(this)) < amount + fee) return;

        bytes32 intentId = keccak256(abi.encode("invariant-payment", address(this), _intentIds.length));
        PaymentRouter.PaymentIntent memory intent = PaymentRouter.PaymentIntent({
            intentId: intentId,
            merchant: merchant,
            signer: signer,
            settlementToken: address(token),
            settlementAmount: amount,
            splitId: bytes32(0),
            splitHash: keccak256(abi.encode(_singleAddress(payout), _singleBps(10_000))),
            platformFee: fee,
            validAfter: uint48(block.timestamp - 1),
            expiresAt: uint48(block.timestamp + 1 days),
            payer: address(this),
            metadataHash: keccak256(abi.encode(intentId))
        });
        _executeAndRecordPayment(intent, amount, fee);
        _intentIds.push(intentId);
        totalPaid += amount;
        totalPlatformFees += fee;
    }

    function _executeAndRecordPayment(PaymentRouter.PaymentIntent memory intent, uint256 amount, uint256 fee) private {
        bytes memory signature = _signIntent(intent);
        PaymentRouter.PaymentParams memory params = PaymentRouter.PaymentParams({
            tokenIn: address(token), maxAmountIn: amount + fee, adapter: address(0), adapterData: ""
        });
        vm.recordLogs();
        router.pay(intent, signature, params);
        _consumeDistributionLogs(intent.intentId, amount);
        _paymentCalls[intent.intentId] = abi.encodeCall(router.pay, (intent, signature, params));
    }

    function _signIntent(PaymentRouter.PaymentIntent memory intent) private view returns (bytes memory) {
        bytes32 digest = router.hashPaymentIntent(intent);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _consumeDistributionLogs(bytes32 intentId, uint256 amount) private {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        _checkDistributionEvent(logs, intentId, amount);
    }

    function refund(uint256 intentSeed, uint96 rawAmount) external {
        uint256 length = _intentIds.length;
        if (length == 0) return;
        bytes32 intentId = _intentIds[intentSeed % length];
        (,,, uint256 settlementAmount,, uint256 refundedAmount) = router.paymentRecords(merchant, intentId);
        uint256 remaining = settlementAmount - refundedAmount;
        if (remaining == 0) return;

        uint256 amount = (uint256(rawAmount) % remaining) + 1;
        bytes32 refundId = keccak256(abi.encode("invariant-refund", intentId, totalRefunded, rawAmount));
        vm.prank(merchant);
        router.refund(merchant, intentId, refundId, amount);
        totalRefunded += amount;
    }

    function replay(uint256 intentSeed) external {
        uint256 length = _intentIds.length;
        if (length == 0) return;
        bytes32 intentId = _intentIds[intentSeed % length];
        (bool success,) = address(router).call(_paymentCalls[intentId]);
        if (success) replaySuccesses += 1;
    }

    function intentCount() external view returns (uint256) {
        return _intentIds.length;
    }

    function intentIdAt(uint256 index) external view returns (bytes32) {
        return _intentIds[index];
    }

    function _singleAddress(address value) private pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = value;
    }

    function _singleBps(uint16 value) private pure returns (uint16[] memory values) {
        values = new uint16[](1);
        values[0] = value;
    }

    function _checkDistributionEvent(Vm.Log[] memory logs, bytes32 intentId, uint256 amount) private {
        bytes32 merchantTopic = bytes32(uint256(uint160(merchant)));
        bytes32 payoutTopic = bytes32(uint256(uint160(payout)));
        uint256 eventCount;
        bool canonicalEventFound;

        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory entry = logs[i];
            if (
                entry.emitter == address(router) && entry.topics.length == 4
                    && entry.topics[0] == SETTLEMENT_DISTRIBUTED_TOPIC && entry.topics[1] == intentId
            ) {
                ++eventCount;
                (address settlementToken, uint256 distributedAmount, uint16 basisPoints) =
                    abi.decode(entry.data, (address, uint256, uint16));
                if (
                    entry.topics[2] == merchantTopic && entry.topics[3] == payoutTopic
                        && settlementToken == address(token) && distributedAmount == amount && basisPoints == 10_000
                ) {
                    canonicalEventFound = true;
                }
            }
        }
        if (eventCount != 1 || !canonicalEventFound) {
            ++distributionEventMismatches;
        }
    }
}

contract PaymentRouterInvariantTest is StdInvariant, PaymentTestBase {
    PaymentRouterHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new PaymentRouterHandler(router, mockKRW, merchant, payout, signerPrivateKey);
        mockKRW.mint(address(handler), 1_000_000_000_000 * 1e6);
        handler.snapshotInitialBalance();

        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.payDirect.selector;
        selectors[1] = handler.refund.selector;
        selectors[2] = handler.replay.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_RouterNeverRetainsPaymentFunds() public view {
        assertEq(mockKRW.balanceOf(address(router)), 0);
    }

    function invariant_RefundNeverExceedsOriginalSettlement() public view {
        uint256 observedRefunded;
        uint256 count = handler.intentCount();
        for (uint256 i; i < count; ++i) {
            bytes32 intentId = handler.intentIdAt(i);
            (
                address recordMerchant,
                address recordPayer,
                address settlementToken,
                uint256 settlementAmount,,
                uint256 refundedAmount
            ) = router.paymentRecords(merchant, intentId);

            assertTrue(router.usedIntents(merchant, intentId));
            assertEq(recordMerchant, merchant);
            assertEq(recordPayer, address(handler));
            assertEq(settlementToken, address(mockKRW));
            assertLe(refundedAmount, settlementAmount);
            observedRefunded += refundedAmount;
        }
        assertEq(observedRefunded, handler.totalRefunded());
    }

    function invariant_ConservesMerchantFeeAndRefundAccounting() public view {
        assertEq(mockKRW.balanceOf(payout), handler.totalPaid());
        assertEq(mockKRW.balanceOf(platformFeeRecipient), handler.totalPlatformFees());
        assertEq(
            mockKRW.balanceOf(address(handler)),
            handler.initialBalance() - handler.totalPaid() - handler.totalPlatformFees() + handler.totalRefunded()
        );
    }

    function invariant_UsedIntentsNeverReplay() public view {
        assertEq(handler.replaySuccesses(), 0);
    }

    function invariant_EveryPaymentHasCanonicalDistributionEvent() public view {
        assertEq(handler.distributionEventMismatches(), 0);
    }
}
