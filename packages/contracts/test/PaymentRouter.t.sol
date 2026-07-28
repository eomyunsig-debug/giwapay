// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PaymentTestBase} from "./PaymentTestBase.sol";
import {Vm} from "forge-std/Vm.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {AdapterRegistry} from "../src/AdapterRegistry.sol";
import {
    FeeOnTransferToken,
    SenderFeeToken,
    LyingExactOutputAdapter,
    ShortOutputAdapter,
    ReentrantExactOutputAdapter,
    TestERC1271Signer
} from "./mocks/MaliciousContracts.sol";

contract PaymentRouterTest is PaymentTestBase {
    bytes32 private constant SETTLEMENT_DISTRIBUTED_TOPIC =
        keccak256("SettlementDistributed(bytes32,address,address,address,uint256,uint16)");

    function test_DirectPaymentSettlesExactAmountAndFee() public {
        uint256 settlementAmount = 100_000 * 1e6;
        uint256 fee = _platformFee(settlementAmount);
        bytes32 intentId = keccak256("direct");
        PaymentRouter.PaymentIntent memory intent =
            _intent(intentId, address(mockKRW), settlementAmount, bytes32(0), address(0));
        bytes memory signature = _sign(intent);

        uint256 payerBefore = mockKRW.balanceOf(payer);
        vm.expectEmit(true, true, true, true);
        emit PaymentRouter.PaymentSucceeded(
            intentId,
            merchant,
            payer,
            address(mockKRW),
            address(mockKRW),
            settlementAmount + fee,
            settlementAmount,
            fee,
            bytes32(0),
            address(0)
        );
        vm.prank(payer);
        uint256 amountIn = router.pay(intent, signature, _directParams(address(mockKRW), settlementAmount + fee));

        assertEq(amountIn, settlementAmount + fee);
        assertEq(mockKRW.balanceOf(payout), settlementAmount);
        assertEq(mockKRW.balanceOf(platformFeeRecipient), fee);
        assertEq(mockKRW.balanceOf(payer), payerBefore - settlementAmount - fee);
        assertEq(mockKRW.balanceOf(address(router)), 0);
        assertTrue(router.usedIntents(merchant, intentId));
    }

    function test_ExactOutputPaymentRefundsUnusedInput() public {
        uint256 settlementAmount = 100 * 1e6;
        uint256 fee = _platformFee(settlementAmount);
        uint256 exactInput = (settlementAmount + fee) * 1e12;
        uint256 maximumInput = 110 * 1e18;
        PaymentRouter.PaymentIntent memory intent =
            _intent(keccak256("adapter"), address(mockKRW), settlementAmount, bytes32(0), payer);
        bytes memory signature = _sign(intent);

        uint256 payerBefore = mockALT.balanceOf(payer);
        vm.prank(payer);
        uint256 amountIn = router.pay(intent, signature, _adapterParams(address(mockALT), maximumInput));

        assertEq(amountIn, exactInput);
        assertEq(mockALT.balanceOf(payer), payerBefore - exactInput);
        assertEq(mockKRW.balanceOf(payout), settlementAmount);
        assertEq(mockKRW.balanceOf(platformFeeRecipient), fee);
        assertEq(mockALT.balanceOf(address(router)), 0);
        assertEq(mockKRW.balanceOf(address(router)), 0);
        assertEq(mockALT.allowance(address(router), address(adapter)), 0);
    }

    function test_SplitDistributionIsExactIncludingRemainder() public {
        bytes32 splitId = keccak256("70-30");
        address[] memory recipients = new address[](2);
        recipients[0] = payout;
        recipients[1] = splitRecipient;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 7_000;
        bps[1] = 3_000;
        vm.prank(merchant);
        merchantRegistry.createSplitTemplate(splitId, recipients, bps);

        uint256 settlementAmount = 101;
        uint256 fee = _platformFee(settlementAmount);
        PaymentRouter.PaymentIntent memory intent =
            _intent(keccak256("split-payment"), address(mockKRW), settlementAmount, splitId, address(0));
        bytes memory signature = _sign(intent);

        vm.recordLogs();
        vm.prank(payer);
        router.pay(intent, signature, _directParams(address(mockKRW), settlementAmount + fee));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(mockKRW.balanceOf(payout), 70);
        assertEq(mockKRW.balanceOf(splitRecipient), 31);
        assertEq(mockKRW.balanceOf(platformFeeRecipient), fee);

        (bool payoutFound, address payoutToken, uint256 payoutAmount, uint16 payoutBps) =
            _findSettlementEvent(logs, intent.intentId, payout);
        (bool splitFound, address splitToken, uint256 splitAmount, uint16 splitBps) =
            _findSettlementEvent(logs, intent.intentId, splitRecipient);
        assertTrue(payoutFound);
        assertTrue(splitFound);
        assertEq(payoutToken, address(mockKRW));
        assertEq(splitToken, address(mockKRW));
        assertEq(payoutAmount, 70);
        assertEq(splitAmount, 31);
        assertEq(payoutBps, 7_000);
        assertEq(splitBps, 3_000);
        assertEq(_countSettlementEvents(logs, intent.intentId), 2);
    }

    function test_DistributionEventIncludesZeroAmount() public {
        bytes32 splitId = keccak256("rounding-zero");
        address[] memory recipients = new address[](2);
        recipients[0] = payout;
        recipients[1] = splitRecipient;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 7_000;
        bps[1] = 3_000;
        vm.prank(merchant);
        merchantRegistry.createSplitTemplate(splitId, recipients, bps);

        PaymentRouter.PaymentIntent memory intent =
            _intent(keccak256("zero-distribution"), address(mockKRW), 1, splitId, address(0));
        bytes memory signature = _sign(intent);

        vm.recordLogs();
        vm.prank(payer);
        router.pay(intent, signature, _directParams(address(mockKRW), 2));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (bool zeroFound, address settlementToken, uint256 zeroAmount, uint16 zeroBps) =
            _findSettlementEvent(logs, intent.intentId, payout);
        (bool remainderFound,, uint256 remainderAmount, uint16 remainderBps) =
            _findSettlementEvent(logs, intent.intentId, splitRecipient);

        assertTrue(zeroFound);
        assertTrue(remainderFound);
        assertEq(settlementToken, address(mockKRW));
        assertEq(zeroAmount, 0);
        assertEq(zeroBps, 7_000);
        assertEq(remainderAmount, 1);
        assertEq(remainderBps, 3_000);
        assertEq(_countSettlementEvents(logs, intent.intentId), 2);
    }

    function test_DefaultPayoutEventRemainsCanonicalAfterPayoutChange() public {
        uint256 amount = 100e6;
        PaymentRouter.PaymentIntent memory intent =
            _intent(keccak256("default-payout-snapshot"), address(mockKRW), amount, bytes32(0), address(0));
        bytes memory signature = _sign(intent);

        vm.recordLogs();
        vm.prank(payer);
        router.pay(intent, signature, _directParams(address(mockKRW), amount + _platformFee(amount)));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        address updatedPayout = makeAddr("updatedPayout");
        vm.prank(merchant);
        merchantRegistry.updatePayoutAddress(updatedPayout);

        (bool oldPayoutFound, address settlementToken, uint256 distributedAmount, uint16 distributedBps) =
            _findSettlementEvent(logs, intent.intentId, payout);
        (address[] memory currentDefaultRecipients,,) = merchantRegistry.getSplitTemplate(merchant, bytes32(0));

        assertTrue(oldPayoutFound);
        assertEq(settlementToken, address(mockKRW));
        assertEq(distributedAmount, amount);
        assertEq(distributedBps, 10_000);
        assertEq(_countSettlementEvents(logs, intent.intentId), 1);
        assertEq(currentDefaultRecipients[0], updatedPayout);
        assertNotEq(currentDefaultRecipients[0], payout);
    }

    function test_DefaultPayoutChangeAfterSigningInvalidatesSplitSnapshot() public {
        uint256 amount = 100e6;
        bytes32 intentId = keccak256("default-payout-race");
        PaymentRouter.PaymentIntent memory intent = _intent(intentId, address(mockKRW), amount, bytes32(0), address(0));
        bytes memory signature = _sign(intent);

        vm.prank(merchant);
        merchantRegistry.updatePayoutAddress(makeAddr("newPayoutBeforeExecution"));

        vm.prank(payer);
        vm.expectRevert(PaymentRouter.InvalidSplitHash.selector);
        router.pay(intent, signature, _directParams(address(mockKRW), amount + _platformFee(amount)));

        assertFalse(router.usedIntents(merchant, intentId));
    }

    function test_ReplayAndWrongPayerAreRejected() public {
        uint256 amount = 1_000e6;
        uint256 maximum = amount + _platformFee(amount);
        PaymentRouter.PaymentIntent memory intent =
            _intent(keccak256("single-use"), address(mockKRW), amount, bytes32(0), payer);
        bytes memory signature = _sign(intent);

        vm.prank(makeAddr("wrongPayer"));
        vm.expectRevert(PaymentRouter.UnauthorizedPayer.selector);
        router.pay(intent, signature, _directParams(address(mockKRW), maximum));

        vm.prank(payer);
        router.pay(intent, signature, _directParams(address(mockKRW), maximum));

        vm.prank(payer);
        vm.expectRevert(PaymentRouter.IntentAlreadyUsed.selector);
        router.pay(intent, signature, _directParams(address(mockKRW), maximum));
    }

    function test_DifferentMerchantsCannotConsumeEachOthersIntentNamespace() public {
        bytes32 sharedIntentId = keccak256("public-shared-intent-id");
        bytes32 sharedRefundId = keccak256("public-shared-refund-id");
        uint256 amount = 10e6;

        uint256 secondSignerPrivateKey = uint256(keccak256("second-merchant-intent-signer"));
        address secondMerchant = makeAddr("secondMerchant");
        address secondPayout = makeAddr("secondPayout");
        address secondSigner = vm.addr(secondSignerPrivateKey);
        vm.prank(secondMerchant);
        merchantRegistry.registerMerchant(secondPayout, secondSigner);

        PaymentRouter.PaymentIntent memory first =
            _intent(sharedIntentId, address(mockKRW), amount, bytes32(0), address(0));
        PaymentRouter.PaymentIntent memory second = abi.decode(abi.encode(first), (PaymentRouter.PaymentIntent));
        second.merchant = secondMerchant;
        second.signer = secondSigner;
        (address[] memory secondRecipients, uint16[] memory secondBps,) =
            merchantRegistry.getSplitTemplate(secondMerchant, bytes32(0));
        second.splitHash = keccak256(abi.encode(secondRecipients, secondBps));
        bytes memory secondSignature = _signWithKey(second, secondSignerPrivateKey);
        bytes memory firstSignature = _sign(first);

        // The second merchant executes first, reproducing the prior
        // cross-merchant intent-ID front-running condition.
        vm.prank(payer);
        router.pay(second, secondSignature, _directParams(address(mockKRW), amount + _platformFee(amount)));
        vm.prank(payer);
        router.pay(first, firstSignature, _directParams(address(mockKRW), amount + _platformFee(amount)));

        assertTrue(router.usedIntents(merchant, sharedIntentId));
        assertTrue(router.usedIntents(secondMerchant, sharedIntentId));
        (address firstRecordMerchant,,,,,) = router.paymentRecords(merchant, sharedIntentId);
        (address secondRecordMerchant,,,,,) = router.paymentRecords(secondMerchant, sharedIntentId);
        assertEq(firstRecordMerchant, merchant);
        assertEq(secondRecordMerchant, secondMerchant);

        mockKRW.mint(secondMerchant, 2);
        vm.prank(secondMerchant);
        mockKRW.approve(address(router), 2);
        vm.prank(merchant);
        router.refund(merchant, sharedIntentId, sharedRefundId, 1);
        vm.prank(secondMerchant);
        router.refund(secondMerchant, sharedIntentId, sharedRefundId, 1);

        assertTrue(router.usedRefundIds(merchant, sharedIntentId, sharedRefundId));
        assertTrue(router.usedRefundIds(secondMerchant, sharedIntentId, sharedRefundId));
    }

    function test_ExpirySignerRotationAndExactFeePolicy() public {
        uint256 amount = 100e6;
        PaymentRouter.PaymentIntent memory expired =
            _intent(keccak256("expired"), address(mockKRW), amount, bytes32(0), address(0));
        expired.expiresAt = uint48(block.timestamp - 1);
        expired.validAfter = uint48(block.timestamp - 2);
        bytes memory expiredSignature = _sign(expired);
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.IntentExpired.selector);
        router.pay(expired, expiredSignature, _directParams(address(mockKRW), amount + _platformFee(amount)));

        PaymentRouter.PaymentIntent memory wrongFee =
            _intent(keccak256("wrong-fee"), address(mockKRW), amount, bytes32(0), address(0));
        wrongFee.platformFee += 1;
        bytes memory wrongFeeSignature = _sign(wrongFee);
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.InvalidPlatformFee.selector);
        router.pay(wrongFee, wrongFeeSignature, _directParams(address(mockKRW), amount + wrongFee.platformFee));

        PaymentRouter.PaymentIntent memory oldSignerIntent =
            _intent(keccak256("old-signer"), address(mockKRW), amount, bytes32(0), address(0));
        bytes memory oldSignature = _sign(oldSignerIntent);
        vm.prank(merchant);
        merchantRegistry.rotateDelegatedSigner(makeAddr("newSigner"));

        vm.prank(payer);
        vm.expectRevert(PaymentRouter.InvalidIntentSignature.selector);
        router.pay(oldSignerIntent, oldSignature, _directParams(address(mockKRW), amount + _platformFee(amount)));
    }

    function test_ERC1271DelegatedSignerCanAuthorizePayment() public {
        uint256 smartSignerOwnerKey = uint256(keccak256("erc1271-owner"));
        TestERC1271Signer smartSigner = new TestERC1271Signer(vm.addr(smartSignerOwnerKey));
        vm.prank(merchant);
        merchantRegistry.rotateDelegatedSigner(address(smartSigner));

        uint256 amount = 100e6;
        PaymentRouter.PaymentIntent memory intent =
            _intent(keccak256("erc1271-payment"), address(mockKRW), amount, bytes32(0), address(0));
        intent.signer = address(smartSigner);
        bytes memory signature = _signWithKey(intent, smartSignerOwnerKey);

        vm.prank(payer);
        router.pay(intent, signature, _directParams(address(mockKRW), amount + _platformFee(amount)));

        assertTrue(router.usedIntents(merchant, intent.intentId));
        assertEq(mockKRW.balanceOf(payout), amount);
    }

    function test_ERC1271RejectsSignatureFromWrongOwner() public {
        uint256 smartSignerOwnerKey = uint256(keccak256("erc1271-owner"));
        TestERC1271Signer smartSigner = new TestERC1271Signer(vm.addr(smartSignerOwnerKey));
        vm.prank(merchant);
        merchantRegistry.rotateDelegatedSigner(address(smartSigner));

        uint256 amount = 100e6;
        PaymentRouter.PaymentIntent memory intent =
            _intent(keccak256("erc1271-wrong-owner"), address(mockKRW), amount, bytes32(0), address(0));
        intent.signer = address(smartSigner);
        bytes memory signature = _signWithKey(intent, signerPrivateKey);

        vm.prank(payer);
        vm.expectRevert(PaymentRouter.InvalidIntentSignature.selector);
        router.pay(intent, signature, _directParams(address(mockKRW), amount + _platformFee(amount)));
    }

    function test_FullAndPartialMerchantFundedRefund() public {
        bytes32 intentId = keccak256("refundable");
        uint256 amount = 100e6;
        uint256 payerBefore = mockKRW.balanceOf(payer);
        PaymentRouter.PaymentIntent memory intent = _intent(intentId, address(mockKRW), amount, bytes32(0), address(0));
        bytes memory signature = _sign(intent);
        vm.prank(payer);
        router.pay(intent, signature, _directParams(address(mockKRW), amount + _platformFee(amount)));

        vm.expectEmit(true, true, true, true);
        emit PaymentRouter.Refunded(
            intentId, keccak256("refund-1"), merchant, payer, address(mockKRW), 40e6, 40e6, merchant
        );
        vm.prank(merchant);
        router.refund(merchant, intentId, keccak256("refund-1"), 40e6);

        vm.prank(merchant);
        vm.expectRevert(PaymentRouter.RefundIdAlreadyUsed.selector);
        router.refund(merchant, intentId, keccak256("refund-1"), 1);

        vm.prank(merchant);
        router.refund(merchant, intentId, keccak256("refund-2"), 60e6);

        (,,,,, uint256 refundedAmount) = router.paymentRecords(merchant, intentId);
        assertEq(refundedAmount, amount);
        assertEq(mockKRW.balanceOf(payer), payerBefore - _platformFee(amount));

        vm.prank(merchant);
        vm.expectRevert(PaymentRouter.InvalidRefundAmount.selector);
        router.refund(merchant, intentId, keccak256("refund-3"), 1);
    }

    function test_RefundIdReplayProtectionIsScopedToPayment() public {
        bytes32 firstIntentId = keccak256("refund-scope-first");
        bytes32 secondIntentId = keccak256("refund-scope-second");
        bytes32 sharedRefundId = keccak256("same-public-refund-id");
        uint256 amount = 10e6;

        PaymentRouter.PaymentIntent memory first =
            _intent(firstIntentId, address(mockKRW), amount, bytes32(0), address(0));
        PaymentRouter.PaymentIntent memory second =
            _intent(secondIntentId, address(mockKRW), amount, bytes32(0), address(0));

        vm.startPrank(payer);
        router.pay(first, _sign(first), _directParams(address(mockKRW), amount + first.platformFee));
        router.pay(second, _sign(second), _directParams(address(mockKRW), amount + second.platformFee));
        vm.stopPrank();

        vm.startPrank(merchant);
        router.refund(merchant, firstIntentId, sharedRefundId, 1e6);
        router.refund(merchant, secondIntentId, sharedRefundId, 1e6);
        vm.expectRevert(PaymentRouter.RefundIdAlreadyUsed.selector);
        router.refund(merchant, firstIntentId, sharedRefundId, 1);
        vm.stopPrank();

        assertTrue(router.usedRefundIds(merchant, firstIntentId, sharedRefundId));
        assertTrue(router.usedRefundIds(merchant, secondIntentId, sharedRefundId));
    }

    function test_UnauthorizedRefundRejectedAndRefundWorksWhilePaused() public {
        bytes32 intentId = keccak256("paused-refund");
        uint256 amount = 100e6;
        PaymentRouter.PaymentIntent memory intent = _intent(intentId, address(mockKRW), amount, bytes32(0), address(0));
        bytes memory signature = _sign(intent);
        vm.prank(payer);
        router.pay(intent, signature, _directParams(address(mockKRW), amount + _platformFee(amount)));

        vm.prank(makeAddr("attacker"));
        vm.expectRevert(PaymentRouter.UnauthorizedRefundOperator.selector);
        router.refund(merchant, intentId, keccak256("attack-refund"), 1);

        router.pause();
        vm.prank(merchant);
        router.refund(merchant, intentId, keccak256("paused-full-refund"), amount);
    }

    function test_AdminRotationPreservesHistoricalPaymentAndRefundNamespace() public {
        bytes32 intentId = keccak256("admin-rotation-refund");
        uint256 amount = 100e6;
        PaymentRouter.PaymentIntent memory intent = _intent(intentId, address(mockKRW), amount, bytes32(0), address(0));
        bytes memory signature = _sign(intent);
        vm.prank(payer);
        router.pay(intent, signature, _directParams(address(mockKRW), amount + _platformFee(amount)));

        address newAdmin = makeAddr("newAdmin");
        vm.prank(merchant);
        merchantRegistry.proposeAdmin(newAdmin);
        vm.prank(newAdmin);
        merchantRegistry.acceptAdmin(merchant);

        mockKRW.mint(newAdmin, amount);
        vm.prank(newAdmin);
        mockKRW.approve(address(router), amount);

        vm.prank(merchant);
        vm.expectRevert(PaymentRouter.UnauthorizedRefundOperator.selector);
        router.refund(merchant, intentId, keccak256("old-admin-refund"), 1);

        vm.prank(newAdmin);
        router.refund(merchant, intentId, keccak256("new-admin-refund"), amount);
        (,,,,, uint256 refundedAmount) = router.paymentRecords(merchant, intentId);
        assertEq(refundedAmount, amount);
    }

    function test_FeeOnTransferIncomingAndOutgoingAreRejected() public {
        FeeOnTransferToken incomingFeeToken = new FeeOnTransferToken();
        incomingFeeToken.mint(payer, 1_000e18);
        vm.prank(payer);
        incomingFeeToken.approve(address(router), type(uint256).max);

        PaymentRouter.PaymentIntent memory incomingIntent =
            _intent(keccak256("incoming-fee"), address(incomingFeeToken), 100e18, bytes32(0), address(0));
        bytes memory incomingSignature = _sign(incomingIntent);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(PaymentRouter.FeeOnTransferTokenUnsupported.selector, address(incomingFeeToken))
        );
        router.pay(
            incomingIntent,
            incomingSignature,
            _directParams(address(incomingFeeToken), incomingIntent.settlementAmount + incomingIntent.platformFee)
        );

        SenderFeeToken outgoingFeeToken = new SenderFeeToken();
        outgoingFeeToken.mint(payer, 1_000e18);
        outgoingFeeToken.setTaxedSender(address(router));
        vm.prank(payer);
        outgoingFeeToken.approve(address(router), type(uint256).max);
        PaymentRouter.PaymentIntent memory outgoingIntent =
            _intent(keccak256("outgoing-fee"), address(outgoingFeeToken), 100e18, bytes32(0), address(0));
        bytes memory outgoingSignature = _sign(outgoingIntent);
        vm.prank(payer);
        vm.expectPartialRevert(PaymentRouter.ExactTransferFailed.selector);
        router.pay(
            outgoingIntent,
            outgoingSignature,
            _directParams(address(outgoingFeeToken), outgoingIntent.settlementAmount + outgoingIntent.platformFee)
        );
    }

    function test_MaliciousAdapterAccountingFailuresRevertAtomically() public {
        uint256 amount = 100e6;
        PaymentRouter.PaymentIntent memory intent =
            _intent(keccak256("lying-adapter"), address(mockKRW), amount, bytes32(0), address(0));
        LyingExactOutputAdapter lyingAdapter = new LyingExactOutputAdapter();
        mockKRW.mint(address(lyingAdapter), 1_000e6);
        _registerMaliciousAdapter(address(lyingAdapter));

        PaymentRouter.PaymentParams memory params = PaymentRouter.PaymentParams({
            tokenIn: address(mockUSDC), maxAmountIn: 110e6, adapter: address(lyingAdapter), adapterData: ""
        });
        bytes memory lyingSignature = _sign(intent);
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.AdapterInputAccountingMismatch.selector);
        router.pay(intent, lyingSignature, params);
        assertFalse(router.usedIntents(merchant, intent.intentId));

        PaymentRouter.PaymentIntent memory shortIntent =
            _intent(keccak256("short-adapter"), address(mockKRW), amount, bytes32(0), address(0));
        ShortOutputAdapter shortAdapter = new ShortOutputAdapter();
        mockKRW.mint(address(shortAdapter), 1_000e6);
        _registerMaliciousAdapter(address(shortAdapter));
        params.adapter = address(shortAdapter);
        bytes memory shortSignature = _sign(shortIntent);
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.AdapterOutputAccountingMismatch.selector);
        router.pay(shortIntent, shortSignature, params);
        assertFalse(router.usedIntents(merchant, shortIntent.intentId));
    }

    function test_ReentrantAdapterCannotEnterRouter() public {
        uint256 amount = 100e6;
        ReentrantExactOutputAdapter reentrantAdapter = new ReentrantExactOutputAdapter(address(router));
        mockKRW.mint(address(reentrantAdapter), 1_000e6);
        _registerMaliciousAdapter(address(reentrantAdapter));

        PaymentRouter.PaymentIntent memory reentryIntent =
            _intent(keccak256("reentry-inner"), address(mockKRW), 1e6, bytes32(0), address(0));
        bytes memory reentryCall =
            abi.encodeCall(router.pay, (reentryIntent, _sign(reentryIntent), _directParams(address(mockKRW), 2e6)));
        reentrantAdapter.setReentrantCall(reentryCall);

        PaymentRouter.PaymentIntent memory outerIntent =
            _intent(keccak256("reentry-outer"), address(mockKRW), amount, bytes32(0), address(0));
        bytes memory outerSignature = _sign(outerIntent);
        PaymentRouter.PaymentParams memory params = PaymentRouter.PaymentParams({
            tokenIn: address(mockUSDC),
            maxAmountIn: amount + _platformFee(amount),
            adapter: address(reentrantAdapter),
            adapterData: ""
        });
        vm.prank(payer);
        router.pay(outerIntent, outerSignature, params);

        assertTrue(reentrantAdapter.reentryBlocked());
        assertFalse(router.usedIntents(merchant, reentryIntent.intentId));
        assertTrue(router.usedIntents(merchant, outerIntent.intentId));
    }

    function testFuzz_DirectPaymentAlwaysSettlesExact(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000 * 1e6);
        uint256 fee = _platformFee(amount);
        bytes32 intentId = keccak256(abi.encode("fuzz", amount));
        PaymentRouter.PaymentIntent memory intent = _intent(intentId, address(mockKRW), amount, bytes32(0), address(0));
        bytes memory signature = _sign(intent);

        uint256 payoutBefore = mockKRW.balanceOf(payout);
        uint256 feeBefore = mockKRW.balanceOf(platformFeeRecipient);
        vm.recordLogs();
        vm.prank(payer);
        router.pay(intent, signature, _directParams(address(mockKRW), amount + fee));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(mockKRW.balanceOf(payout) - payoutBefore, amount);
        assertEq(mockKRW.balanceOf(platformFeeRecipient) - feeBefore, fee);
        assertEq(mockKRW.balanceOf(address(router)), 0);
        (bool found, address settlementToken, uint256 distributedAmount, uint16 bps) =
            _findSettlementEvent(logs, intentId, payout);
        assertTrue(found);
        assertEq(settlementToken, address(mockKRW));
        assertEq(distributedAmount, amount);
        assertEq(bps, 10_000);
        assertEq(_countSettlementEvents(logs, intentId), 1);
    }

    function _registerMaliciousAdapter(address maliciousAdapter) private {
        adapterRegistry.registerAdapter(maliciousAdapter, "malicious-test", true);
        adapterRegistry.setPairSupport(maliciousAdapter, address(mockUSDC), address(mockKRW), true);
        adapterRegistry.setTokenInputCap(maliciousAdapter, address(mockUSDC), type(uint128).max);
    }

    function _findSettlementEvent(Vm.Log[] memory logs, bytes32 intentId, address recipient)
        private
        view
        returns (bool found, address settlementToken, uint256 amount, uint16 basisPoints)
    {
        bytes32 merchantTopic = bytes32(uint256(uint160(merchant)));
        bytes32 recipientTopic = bytes32(uint256(uint160(recipient)));
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory entry = logs[i];
            if (
                entry.emitter == address(router) && entry.topics.length == 4
                    && entry.topics[0] == SETTLEMENT_DISTRIBUTED_TOPIC && entry.topics[1] == intentId
                    && entry.topics[2] == merchantTopic && entry.topics[3] == recipientTopic
            ) {
                (settlementToken, amount, basisPoints) = abi.decode(entry.data, (address, uint256, uint16));
                return (true, settlementToken, amount, basisPoints);
            }
        }
    }

    function _countSettlementEvents(Vm.Log[] memory logs, bytes32 intentId) private view returns (uint256 count) {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory entry = logs[i];
            if (
                entry.emitter == address(router) && entry.topics.length == 4
                    && entry.topics[0] == SETTLEMENT_DISTRIBUTED_TOPIC && entry.topics[1] == intentId
            ) {
                ++count;
            }
        }
    }
}
