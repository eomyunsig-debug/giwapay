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

/// @notice Deploys the complete testnet demo to a local Anvil chain.
/// @dev Use Anvil's unlocked account via Forge's `--unlocked --sender` flags.
/// The script never reads or embeds a private key.
contract DeployLocal is Script {
    using SafeCast for uint256;

    uint256 private constant LOCAL_GIWA_CHAIN_ID = 91_342;
    uint256 private constant DEFAULT_PLATFORM_FEE_BPS = 50;
    uint64 private constant DEFAULT_FAUCET_COOLDOWN = 1 hours;

    struct Deployment {
        MerchantRegistry merchantRegistry;
        AdapterRegistry adapterRegistry;
        PaymentRouter paymentRouter;
        MockKRW mockKRW;
        MockUSDC mockUSDC;
        MockALT mockALT;
        MockTokenFaucet faucet;
        MockFixedRateExactOutputAdapter adapter;
    }

    function run() external returns (Deployment memory deployment) {
        require(block.chainid == LOCAL_GIWA_CHAIN_ID, "DeployLocal: Anvil --chain-id 91342 required");

        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address feeRecipient = vm.envOr("PLATFORM_FEE_RECIPIENT", deployer);
        uint256 configuredFeeBps = vm.envOr("PLATFORM_FEE_BPS", DEFAULT_PLATFORM_FEE_BPS);
        require(configuredFeeBps <= 10_000, "DeployLocal: invalid fee bps");
        uint16 feeBps = configuredFeeBps.toUint16();

        vm.startBroadcast();

        deployment.merchantRegistry = new MerchantRegistry();
        deployment.adapterRegistry = new AdapterRegistry(deployer, deployer, false);
        deployment.paymentRouter =
            new PaymentRouter(deployer, deployment.merchantRegistry, deployment.adapterRegistry, feeRecipient, feeBps);

        deployment.mockKRW = new MockKRW(deployer);
        deployment.mockUSDC = new MockUSDC(deployer);
        deployment.mockALT = new MockALT(deployer);
        deployment.faucet = new MockTokenFaucet(deployer);
        deployment.adapter = new MockFixedRateExactOutputAdapter(deployer);

        deployment.mockKRW.grantRole(deployment.mockKRW.MINTER_ROLE(), address(deployment.faucet));
        deployment.mockUSDC.grantRole(deployment.mockUSDC.MINTER_ROLE(), address(deployment.faucet));
        deployment.mockALT.grantRole(deployment.mockALT.MINTER_ROLE(), address(deployment.faucet));

        deployment.faucet.configureToken(address(deployment.mockKRW), 1_000_000 * 1e6, DEFAULT_FAUCET_COOLDOWN, true);
        deployment.faucet.configureToken(address(deployment.mockUSDC), 1_000 * 1e6, DEFAULT_FAUCET_COOLDOWN, true);
        deployment.faucet.configureToken(address(deployment.mockALT), 1_000 * 1e18, DEFAULT_FAUCET_COOLDOWN, true);

        deployment.adapter.setRate(address(deployment.mockUSDC), address(deployment.mockKRW), 1, 1, true);
        deployment.adapter.setRate(address(deployment.mockALT), address(deployment.mockKRW), 1e12, 1, true);
        deployment.mockKRW.mint(address(deployment.adapter), 1_000_000_000 * 1e6);

        deployment.adapterRegistry.registerAdapter(address(deployment.adapter), "mock-fixed-rate-v1", true);
        deployment.adapterRegistry
            .setPairSupport(
                address(deployment.adapter), address(deployment.mockUSDC), address(deployment.mockKRW), true
            );
        deployment.adapterRegistry
                .setPairSupport(
                address(deployment.adapter), address(deployment.mockALT), address(deployment.mockKRW), true
            );
        deployment.adapterRegistry
            .setTokenInputCap(address(deployment.adapter), address(deployment.mockUSDC), 1_000_000_000 * 1e6);
        deployment.adapterRegistry
            .setTokenInputCap(address(deployment.adapter), address(deployment.mockALT), 1_000_000_000 * 1e18);

        vm.stopBroadcast();

        _logDeployment(deployment);
    }

    function _logDeployment(Deployment memory deployment) private pure {
        console2.log("MerchantRegistry", address(deployment.merchantRegistry));
        console2.log("AdapterRegistry", address(deployment.adapterRegistry));
        console2.log("PaymentRouter", address(deployment.paymentRouter));
        console2.log("MockKRW (TESTNET DEMO)", address(deployment.mockKRW));
        console2.log("MockUSDC (TESTNET DEMO)", address(deployment.mockUSDC));
        console2.log("MockALT (TESTNET DEMO)", address(deployment.mockALT));
        console2.log("MockTokenFaucet", address(deployment.faucet));
        console2.log("MockExactOutputAdapter", address(deployment.adapter));
    }
}
