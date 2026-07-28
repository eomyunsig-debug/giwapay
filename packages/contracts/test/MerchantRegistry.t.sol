// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {IMerchantRegistry} from "../src/interfaces/IMerchantRegistry.sol";

contract MerchantRegistryTest is Test {
    MerchantRegistry internal registry;

    address internal merchant = makeAddr("merchant");
    address internal payout = makeAddr("payout");
    address internal signer = makeAddr("signer");
    address internal operator = makeAddr("operator");

    function setUp() public {
        vm.warp(1_000_000);
        registry = new MerchantRegistry();
    }

    function test_RegisterAndReadDefaultSplit() public {
        vm.expectEmit(true, true, true, false);
        emit MerchantRegistry.MerchantRegistered(merchant, payout, signer, uint64(block.timestamp));
        vm.prank(merchant);
        registry.registerMerchant(payout, signer);

        IMerchantRegistry.Merchant memory record = registry.getMerchant(merchant);
        assertEq(record.admin, merchant);
        assertEq(record.payoutAddress, payout);
        assertEq(record.delegatedSigner, signer);
        assertTrue(record.active);
        assertTrue(registry.isAuthorizedIntentSigner(merchant, signer));

        (address[] memory recipients, uint16[] memory basisPoints, bool enabled) =
            registry.getSplitTemplate(merchant, bytes32(0));
        assertTrue(enabled);
        assertEq(recipients.length, 1);
        assertEq(recipients[0], payout);
        assertEq(basisPoints[0], 10_000);
    }

    function test_AdminCanRotateAndRevokeNarrowRoles() public {
        _register();
        address newSigner = makeAddr("newSigner");

        vm.startPrank(merchant);
        registry.rotateDelegatedSigner(newSigner);
        registry.setRefundOperator(operator);
        vm.stopPrank();

        assertFalse(registry.isAuthorizedIntentSigner(merchant, signer));
        assertTrue(registry.isAuthorizedIntentSigner(merchant, newSigner));
        assertTrue(registry.isAuthorizedRefundOperator(merchant, merchant));
        assertTrue(registry.isAuthorizedRefundOperator(merchant, operator));

        vm.startPrank(merchant);
        registry.revokeDelegatedSigner();
        registry.revokeRefundOperator();
        vm.stopPrank();

        assertFalse(registry.isAuthorizedIntentSigner(merchant, newSigner));
        assertFalse(registry.isAuthorizedRefundOperator(merchant, operator));
    }

    function test_DelegatedSignerCannotMutateMerchant() public {
        _register();
        vm.prank(signer);
        vm.expectRevert(MerchantRegistry.MerchantNotRegistered.selector);
        registry.updatePayoutAddress(makeAddr("attacker"));
    }

    function test_DelegatedSignerRoleCannotOverlapPrivilegedOrPayoutRoles() public {
        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.RoleSeparationRequired.selector);
        registry.registerMerchant(payout, merchant);

        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.RoleSeparationRequired.selector);
        registry.registerMerchant(signer, signer);

        _register();
        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.RoleSeparationRequired.selector);
        registry.updatePayoutAddress(signer);

        vm.prank(merchant);
        registry.setRefundOperator(operator);

        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.RoleSeparationRequired.selector);
        registry.rotateDelegatedSigner(operator);

        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.RoleSeparationRequired.selector);
        registry.setRefundOperator(signer);
    }

    function test_SplitIsImmutableAndCanBeDisabled() public {
        _register();
        bytes32 splitId = keccak256("split-v1");
        address[] memory recipients = new address[](2);
        recipients[0] = payout;
        recipients[1] = operator;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 7_000;
        bps[1] = 3_000;

        vm.prank(merchant);
        registry.createSplitTemplate(splitId, recipients, bps);
        assertEq(registry.splitTemplateCount(merchant), 1);
        assertEq(registry.splitTemplateIdAt(merchant, 0), splitId);

        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.SplitAlreadyExists.selector);
        registry.createSplitTemplate(splitId, recipients, bps);

        vm.prank(merchant);
        registry.disableSplitTemplate(splitId);

        (,, bool enabled) = registry.getSplitTemplate(merchant, splitId);
        assertFalse(enabled);
    }

    function test_RevertSplitWithDuplicateZeroOrInvalidTotal() public {
        _register();
        address[] memory recipients = new address[](2);
        recipients[0] = payout;
        recipients[1] = payout;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.DuplicateRecipient.selector);
        registry.createSplitTemplate(keccak256("duplicate"), recipients, bps);

        recipients[1] = operator;
        bps[0] = 10_000;
        bps[1] = 0;
        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.ZeroBasisPoints.selector);
        registry.createSplitTemplate(keccak256("zero-bps"), recipients, bps);

        bps[0] = 4_000;
        bps[1] = 5_000;
        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.InvalidBasisPointsTotal.selector);
        registry.createSplitTemplate(keccak256("bad-total"), recipients, bps);
    }

    function testFuzz_ValidTwoRecipientSplit(uint16 firstBps) public {
        firstBps = uint16(bound(firstBps, 1, 9_999));
        _register();

        address[] memory recipients = new address[](2);
        recipients[0] = payout;
        recipients[1] = operator;
        uint16[] memory bps = new uint16[](2);
        bps[0] = firstBps;
        bps[1] = uint16(10_000 - firstBps);
        bytes32 splitId = keccak256(abi.encode(firstBps));

        vm.prank(merchant);
        registry.createSplitTemplate(splitId, recipients, bps);

        (address[] memory storedRecipients, uint16[] memory storedBps, bool enabled) =
            registry.getSplitTemplate(merchant, splitId);
        assertTrue(enabled);
        assertEq(storedRecipients, recipients);
        assertEq(storedBps.length, bps.length);
        for (uint256 i; i < bps.length; ++i) {
            assertEq(storedBps[i], bps[i]);
        }
    }

    function test_PauseInvalidatesSignerAndCanReactivate() public {
        _register();
        vm.prank(merchant);
        registry.pauseMerchant();
        assertFalse(registry.isAuthorizedIntentSigner(merchant, signer));

        vm.prank(merchant);
        registry.reactivateMerchant();
        assertTrue(registry.isAuthorizedIntentSigner(merchant, signer));
    }

    function test_TwoStepAdminRotationPreservesStableMerchantIdentity() public {
        _register();
        address newAdmin = makeAddr("newAdmin");
        bytes32 splitId = keccak256("stable-split");
        address[] memory recipients = new address[](1);
        recipients[0] = payout;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        vm.startPrank(merchant);
        registry.createSplitTemplate(splitId, recipients, bps);
        registry.proposeAdmin(newAdmin);
        vm.stopPrank();

        assertEq(registry.merchantForAdmin(merchant), merchant);
        assertEq(registry.pendingAdmin(merchant), newAdmin);
        assertEq(registry.merchantForAdmin(newAdmin), address(0));

        vm.prank(newAdmin);
        registry.acceptAdmin(merchant);

        IMerchantRegistry.Merchant memory record = registry.getMerchant(merchant);
        assertEq(record.admin, newAdmin);
        assertEq(registry.merchantForAdmin(merchant), address(0));
        assertEq(registry.merchantForAdmin(newAdmin), merchant);
        assertEq(registry.pendingAdmin(merchant), address(0));
        assertTrue(registry.isAuthorizedIntentSigner(merchant, signer));
        (address[] memory storedRecipients, uint16[] memory storedBps, bool enabled) =
            registry.getSplitTemplate(merchant, splitId);
        assertTrue(enabled);
        assertEq(storedRecipients[0], payout);
        assertEq(storedBps[0], 10_000);

        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.MerchantNotRegistered.selector);
        registry.pauseMerchant();

        vm.prank(newAdmin);
        registry.pauseMerchant();
        assertFalse(registry.isAuthorizedIntentSigner(merchant, signer));
        assertTrue(registry.isAuthorizedRefundOperator(merchant, newAdmin));
        assertFalse(registry.isAuthorizedRefundOperator(merchant, merchant));
    }

    function test_AdminTransferRequiresExplicitAcceptanceAndCanBeCancelled() public {
        _register();
        address newAdmin = makeAddr("newAdmin");
        address attacker = makeAddr("attacker");

        vm.prank(merchant);
        registry.proposeAdmin(newAdmin);

        vm.prank(attacker);
        vm.expectRevert(MerchantRegistry.UnauthorizedPendingAdmin.selector);
        registry.acceptAdmin(merchant);

        vm.prank(merchant);
        registry.cancelAdminTransfer();
        assertEq(registry.pendingAdmin(merchant), address(0));

        vm.prank(newAdmin);
        vm.expectRevert(MerchantRegistry.UnauthorizedPendingAdmin.selector);
        registry.acceptAdmin(merchant);
    }

    function test_AdminTransferRejectsSignerAndAdminsControllingAnotherMerchant() public {
        _register();
        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.RoleSeparationRequired.selector);
        registry.proposeAdmin(signer);

        address secondMerchant = makeAddr("secondMerchant");
        vm.prank(secondMerchant);
        registry.registerMerchant(makeAddr("secondPayout"), makeAddr("secondSigner"));

        vm.prank(merchant);
        vm.expectRevert(MerchantRegistry.AdminAlreadyControlsMerchant.selector);
        registry.proposeAdmin(secondMerchant);
    }

    function _register() private {
        vm.prank(merchant);
        registry.registerMerchant(payout, signer);
    }
}
