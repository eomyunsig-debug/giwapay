// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {AdapterRegistry} from "../src/AdapterRegistry.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockALT} from "../src/mocks/MockALT.sol";
import {MockFixedRateExactOutputAdapter} from "../src/mocks/MockFixedRateExactOutputAdapter.sol";

abstract contract PaymentTestBase is Test {
    uint16 internal constant PLATFORM_FEE_BPS = 100;

    MerchantRegistry internal merchantRegistry;
    AdapterRegistry internal adapterRegistry;
    PaymentRouter internal router;
    MockKRW internal mockKRW;
    MockUSDC internal mockUSDC;
    MockALT internal mockALT;
    MockFixedRateExactOutputAdapter internal adapter;

    address internal merchant = makeAddr("merchant");
    address internal payout = makeAddr("payout");
    address internal splitRecipient = makeAddr("splitRecipient");
    address internal payer = makeAddr("payer");
    address internal platformFeeRecipient = makeAddr("platformFeeRecipient");
    address internal delegatedSigner;
    uint256 internal signerPrivateKey;

    function setUp() public virtual {
        vm.warp(1_000_000);
        signerPrivateKey = uint256(keccak256("giwapay-runtime-test-intent-signer"));
        delegatedSigner = vm.addr(signerPrivateKey);

        merchantRegistry = new MerchantRegistry();
        adapterRegistry = new AdapterRegistry(address(this), address(this), false);
        router =
            new PaymentRouter(address(this), merchantRegistry, adapterRegistry, platformFeeRecipient, PLATFORM_FEE_BPS);

        mockKRW = new MockKRW(address(this));
        mockUSDC = new MockUSDC(address(this));
        mockALT = new MockALT(address(this));
        adapter = new MockFixedRateExactOutputAdapter(address(this));

        adapter.setRate(address(mockUSDC), address(mockKRW), 1, 1, true);
        adapter.setRate(address(mockALT), address(mockKRW), 1e12, 1, true);
        mockKRW.mint(address(adapter), 10_000_000_000 * 1e6);

        adapterRegistry.registerAdapter(address(adapter), "mock-fixed-rate-v1", true);
        adapterRegistry.setPairSupport(address(adapter), address(mockUSDC), address(mockKRW), true);
        adapterRegistry.setPairSupport(address(adapter), address(mockALT), address(mockKRW), true);
        adapterRegistry.setTokenInputCap(address(adapter), address(mockUSDC), type(uint128).max);
        adapterRegistry.setTokenInputCap(address(adapter), address(mockALT), type(uint128).max);

        vm.prank(merchant);
        merchantRegistry.registerMerchant(payout, delegatedSigner);

        mockKRW.mint(payer, 10_000_000_000 * 1e6);
        mockUSDC.mint(payer, 10_000_000_000 * 1e6);
        mockALT.mint(payer, 10_000_000_000 * 1e18);
        mockKRW.mint(merchant, 10_000_000_000 * 1e6);

        vm.startPrank(payer);
        mockKRW.approve(address(router), type(uint256).max);
        mockUSDC.approve(address(router), type(uint256).max);
        mockALT.approve(address(router), type(uint256).max);
        vm.stopPrank();

        vm.prank(merchant);
        mockKRW.approve(address(router), type(uint256).max);
    }

    function _intent(
        bytes32 intentId,
        address settlementToken,
        uint256 settlementAmount,
        bytes32 splitId,
        address boundPayer
    ) internal view returns (PaymentRouter.PaymentIntent memory intent) {
        (address[] memory recipients, uint16[] memory basisPoints, bool enabled) =
            merchantRegistry.getSplitTemplate(merchant, splitId);
        require(enabled, "PaymentTestBase: split unavailable");
        intent = PaymentRouter.PaymentIntent({
            intentId: intentId,
            merchant: merchant,
            signer: delegatedSigner,
            settlementToken: settlementToken,
            settlementAmount: settlementAmount,
            splitId: splitId,
            splitHash: keccak256(abi.encode(recipients, basisPoints)),
            platformFee: _platformFee(settlementAmount),
            validAfter: uint48(block.timestamp - 1),
            expiresAt: uint48(block.timestamp + 1 days),
            payer: boundPayer,
            metadataHash: keccak256(abi.encode(intentId, "test metadata"))
        });
    }

    function _sign(PaymentRouter.PaymentIntent memory intent) internal view returns (bytes memory signature) {
        return _signWithKey(intent, signerPrivateKey);
    }

    function _signWithKey(PaymentRouter.PaymentIntent memory intent, uint256 privateKey)
        internal
        view
        returns (bytes memory signature)
    {
        bytes32 digest = router.hashPaymentIntent(intent);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _platformFee(uint256 settlementAmount) internal pure returns (uint256) {
        return Math.mulDiv(settlementAmount, PLATFORM_FEE_BPS, 10_000, Math.Rounding.Ceil);
    }

    function _directParams(address token, uint256 maximum) internal pure returns (PaymentRouter.PaymentParams memory) {
        return PaymentRouter.PaymentParams({tokenIn: token, maxAmountIn: maximum, adapter: address(0), adapterData: ""});
    }

    function _adapterParams(address inputToken, uint256 maximum)
        internal
        view
        returns (PaymentRouter.PaymentParams memory)
    {
        return PaymentRouter.PaymentParams({
            tokenIn: inputToken, maxAmountIn: maximum, adapter: address(adapter), adapterData: ""
        });
    }
}
