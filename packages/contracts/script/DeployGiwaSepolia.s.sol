// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {AdapterRegistry} from "../src/AdapterRegistry.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockALT} from "../src/mocks/MockALT.sol";
import {MockTokenFaucet} from "../src/mocks/MockTokenFaucet.sol";
import {MockFixedRateExactOutputAdapter} from "../src/mocks/MockFixedRateExactOutputAdapter.sol";

/// @notice Opt-in GIWA Sepolia deployment. This script hard-fails on every
/// other chain and never reads or embeds a private key. Select a Foundry
/// keystore account at the CLI when intentionally broadcasting.
contract DeployGiwaSepolia is Script {
    using SafeCast for uint256;

    uint256 private constant GIWA_SEPOLIA_CHAIN_ID = 91_342;
    uint256 private constant DEFAULT_PLATFORM_FEE_BPS = 50;

    function run() external {
        require(block.chainid == GIWA_SEPOLIA_CHAIN_ID, "DeployGiwaSepolia: GIWA Sepolia only");

        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address adapterManager = vm.envAddress("ADAPTER_MANAGER_ADDRESS");
        address feeRecipient = vm.envAddress("PLATFORM_FEE_RECIPIENT");
        uint256 configuredFeeBps = vm.envOr("PLATFORM_FEE_BPS", DEFAULT_PLATFORM_FEE_BPS);
        bool productionMode = vm.envOr("PRODUCTION_MODE", true);
        bool deployTestMocks = vm.envOr("DEPLOY_TEST_MOCKS", false);

        require(deployer != address(0), "DeployGiwaSepolia: zero deployer");
        require(adapterManager != address(0), "DeployGiwaSepolia: zero adapter manager");
        require(feeRecipient != address(0), "DeployGiwaSepolia: zero fee recipient");
        require(configuredFeeBps <= 10_000, "DeployGiwaSepolia: invalid fee bps");
        uint16 feeBps = configuredFeeBps.toUint16();
        require(!(productionMode && deployTestMocks), "DeployGiwaSepolia: test mocks forbidden in production mode");

        vm.startBroadcast();

        MerchantRegistry merchantRegistry = new MerchantRegistry();
        AdapterRegistry adapterRegistry = new AdapterRegistry(deployer, adapterManager, productionMode);
        PaymentRouter paymentRouter =
            new PaymentRouter(deployer, merchantRegistry, adapterRegistry, feeRecipient, feeBps);

        console2.log("MerchantRegistry", address(merchantRegistry));
        console2.log("AdapterRegistry", address(adapterRegistry));
        console2.log("PaymentRouter", address(paymentRouter));

        if (deployTestMocks) {
            _deployTestMocks(deployer, adapterManager, adapterRegistry);
        }

        vm.stopBroadcast();
    }

    function _deployTestMocks(address deployer, address adapterManager, AdapterRegistry adapterRegistry) private {
        require(adapterManager == deployer, "DeployGiwaSepolia: deployer must configure demo adapter");

        MockKRW mockKRW = new MockKRW(deployer);
        MockUSDC mockUSDC = new MockUSDC(deployer);
        MockALT mockALT = new MockALT(deployer);
        MockTokenFaucet faucet = new MockTokenFaucet(deployer);
        MockFixedRateExactOutputAdapter adapter = new MockFixedRateExactOutputAdapter(deployer);

        mockKRW.grantRole(mockKRW.MINTER_ROLE(), address(faucet));
        mockUSDC.grantRole(mockUSDC.MINTER_ROLE(), address(faucet));
        mockALT.grantRole(mockALT.MINTER_ROLE(), address(faucet));

        faucet.configureToken(address(mockKRW), 1_000_000 * 1e6, 1 days, true);
        faucet.configureToken(address(mockUSDC), 1_000 * 1e6, 1 days, true);
        faucet.configureToken(address(mockALT), 1_000 * 1e18, 1 days, true);

        adapter.setRate(address(mockUSDC), address(mockKRW), 1, 1, true);
        adapter.setRate(address(mockALT), address(mockKRW), 1e12, 1, true);
        mockKRW.mint(address(adapter), 1_000_000_000 * 1e6);

        adapterRegistry.registerAdapter(address(adapter), "mock-fixed-rate-v1", true);
        adapterRegistry.setPairSupport(address(adapter), address(mockUSDC), address(mockKRW), true);
        adapterRegistry.setPairSupport(address(adapter), address(mockALT), address(mockKRW), true);
        adapterRegistry.setTokenInputCap(address(adapter), address(mockUSDC), 1_000_000_000 * 1e6);
        adapterRegistry.setTokenInputCap(address(adapter), address(mockALT), 1_000_000_000 * 1e18);

        console2.log("MockKRW (TESTNET DEMO)", address(mockKRW));
        console2.log("MockUSDC (TESTNET DEMO)", address(mockUSDC));
        console2.log("MockALT (TESTNET DEMO)", address(mockALT));
        console2.log("MockTokenFaucet", address(faucet));
        console2.log("MockExactOutputAdapter", address(adapter));
    }
}
