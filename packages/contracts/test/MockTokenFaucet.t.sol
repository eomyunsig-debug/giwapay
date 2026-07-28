// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockTokenFaucet} from "../src/mocks/MockTokenFaucet.sol";

contract MockTokenFaucetTest is Test {
    MockUSDC internal token;
    MockTokenFaucet internal faucet;
    address internal claimant = makeAddr("claimant");

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockUSDC(address(this));
        faucet = new MockTokenFaucet(address(this));
        token.grantRole(token.MINTER_ROLE(), address(faucet));
        faucet.configureToken(address(token), 1_000e6, 1 days, true);
    }

    function test_ClaimMintsDirectlyAndEnforcesCooldown() public {
        vm.prank(claimant);
        faucet.claim(address(token));
        assertEq(token.balanceOf(claimant), 1_000e6);
        assertEq(token.balanceOf(address(faucet)), 0);

        vm.prank(claimant);
        vm.expectRevert(abi.encodeWithSelector(MockTokenFaucet.FaucetCooldownActive.selector, block.timestamp + 1 days));
        faucet.claim(address(token));

        vm.warp(block.timestamp + 1 days);
        vm.prank(claimant);
        faucet.claim(address(token));
        assertEq(token.balanceOf(claimant), 2_000e6);
    }

    function test_DisabledTokenCannotBeClaimed() public {
        faucet.configureToken(address(token), 0, 0, false);
        vm.prank(claimant);
        vm.expectRevert(MockTokenFaucet.FaucetDisabled.selector);
        faucet.claim(address(token));
    }
}
