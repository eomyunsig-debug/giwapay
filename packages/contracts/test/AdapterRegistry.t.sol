// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AdapterRegistry} from "../src/AdapterRegistry.sol";
import {MockFixedRateExactOutputAdapter} from "../src/mocks/MockFixedRateExactOutputAdapter.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";

contract DelegatecallAdapter {
    fallback() external {
        assembly {
            pop(delegatecall(gas(), caller(), 0, 0, 0, 0))
        }
    }
}

contract AdapterRegistryTest is Test {
    AdapterRegistry internal registry;
    MockFixedRateExactOutputAdapter internal adapter;
    MockUSDC internal tokenIn;
    MockKRW internal tokenOut;

    function setUp() public {
        registry = new AdapterRegistry(address(this), address(this), false);
        adapter = new MockFixedRateExactOutputAdapter(address(this));
        tokenIn = new MockUSDC(address(this));
        tokenOut = new MockKRW(address(this));
    }

    function test_RegisterConfigureAndValidate() public {
        _registerAndConfigure();
        registry.validateAdapter(address(adapter), address(tokenIn), address(tokenOut), 500e6);

        AdapterRegistry.AdapterConfig memory config = registry.getAdapter(address(adapter));
        assertTrue(config.enabled);
        assertTrue(config.testOnly);
        assertEq(config.runtimeCodeHash, address(adapter).codehash);
        assertEq(config.identifier, "mock-fixed-rate-v1");
    }

    function test_RejectEOAAndTestAdapterInProduction() public {
        vm.expectRevert(AdapterRegistry.AdapterHasNoCode.selector);
        registry.registerAdapter(makeAddr("eoa"), "eoa", false);

        AdapterRegistry productionRegistry = new AdapterRegistry(address(this), address(this), true);
        vm.expectRevert(AdapterRegistry.TestAdapterForbiddenInProduction.selector);
        productionRegistry.registerAdapter(address(adapter), "mock", true);
    }

    function test_RejectsDelegatecallBasedAdaptersAndProxies() public {
        DelegatecallAdapter proxyLikeAdapter = new DelegatecallAdapter();
        vm.expectRevert(AdapterRegistry.AdapterDelegatecallForbidden.selector);
        registry.registerAdapter(address(proxyLikeAdapter), "delegatecall-proxy", false);
    }

    function test_RejectUnsupportedPairAndInputAboveCap() public {
        registry.registerAdapter(address(adapter), "mock", true);
        registry.setTokenInputCap(address(adapter), address(tokenIn), 100e6);

        vm.expectRevert(AdapterRegistry.UnsupportedTokenPair.selector);
        registry.validateAdapter(address(adapter), address(tokenIn), address(tokenOut), 1);

        registry.setPairSupport(address(adapter), address(tokenIn), address(tokenOut), true);
        vm.expectRevert(AdapterRegistry.MaximumInputCapExceeded.selector);
        registry.validateAdapter(address(adapter), address(tokenIn), address(tokenOut), 101e6);
    }

    function test_CodeHashChangeRejectsAndCanBePersistentlyDisabled() public {
        _registerAndConfigure();
        bytes32 originalHash = address(adapter).codehash;
        vm.etch(address(adapter), hex"60006000fd");

        vm.expectRevert(AdapterRegistry.AdapterCodeHashMismatch.selector);
        registry.validateAdapter(address(adapter), address(tokenIn), address(tokenOut), 1);

        registry.disableChangedAdapter(address(adapter));
        AdapterRegistry.AdapterConfig memory config = registry.getAdapter(address(adapter));
        assertFalse(config.enabled);
        assertEq(config.runtimeCodeHash, originalHash);
    }

    function test_PauseStopsAdapterValidation() public {
        _registerAndConfigure();
        registry.pause();
        vm.expectRevert();
        registry.validateAdapter(address(adapter), address(tokenIn), address(tokenOut), 1);
    }

    function test_OwnershipTransferRequiresAcceptance() public {
        address nextOwner = makeAddr("nextOwner");
        registry.transferOwnership(nextOwner);
        assertEq(registry.owner(), address(this));
        assertEq(registry.pendingOwner(), nextOwner);

        vm.prank(nextOwner);
        registry.acceptOwnership();
        assertEq(registry.owner(), nextOwner);
        assertFalse(registry.adapterManagers(address(this)));

        vm.expectRevert(AdapterRegistry.UnauthorizedAdapterManager.selector);
        registry.registerAdapter(address(adapter), "former-owner", true);
    }

    function _registerAndConfigure() private {
        registry.registerAdapter(address(adapter), "mock-fixed-rate-v1", true);
        registry.setPairSupport(address(adapter), address(tokenIn), address(tokenOut), true);
        registry.setTokenInputCap(address(adapter), address(tokenIn), 1_000e6);
    }
}
