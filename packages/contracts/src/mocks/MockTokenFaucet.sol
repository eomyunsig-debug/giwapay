// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMintableERC20} from "../interfaces/IMintableERC20.sol";

/// @title GiwaPay mock token faucet
/// @notice Rate-limited testnet dispenser. Each mock token must explicitly
/// grant this contract its MINTER_ROLE before claims are enabled.
contract MockTokenFaucet is Ownable2Step, ReentrancyGuard {
    struct FaucetConfig {
        uint128 amount;
        uint64 cooldown;
        bool enabled;
    }

    mapping(address token => FaucetConfig config) public faucetConfigs;
    mapping(address token => mapping(address claimant => uint64 claimedAt)) public lastClaimedAt;

    error ZeroAddress();
    error InvalidFaucetConfig();
    error FaucetDisabled();
    error FaucetCooldownActive(uint256 nextClaimAt);

    event FaucetConfigured(address indexed token, uint128 amount, uint64 cooldown, bool enabled);
    event TestTokensClaimed(address indexed token, address indexed claimant, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Configures one clearly labelled mock token.
    function configureToken(address token, uint128 amount, uint64 cooldown, bool enabled) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (enabled && (amount == 0 || cooldown == 0)) revert InvalidFaucetConfig();
        faucetConfigs[token] = FaucetConfig({amount: amount, cooldown: cooldown, enabled: enabled});
        emit FaucetConfigured(token, amount, cooldown, enabled);
    }

    /// @notice Mints the configured test amount directly to the caller.
    function claim(address token) external nonReentrant {
        FaucetConfig memory config = faucetConfigs[token];
        if (!config.enabled) revert FaucetDisabled();

        uint64 previousClaim = lastClaimedAt[token][msg.sender];
        uint256 nextClaimAt = uint256(previousClaim) + config.cooldown;
        if (previousClaim != 0 && block.timestamp < nextClaimAt) {
            revert FaucetCooldownActive(nextClaimAt);
        }

        lastClaimedAt[token][msg.sender] = uint64(block.timestamp);
        IMintableERC20(token).mint(msg.sender, config.amount);
        emit TestTokensClaimed(token, msg.sender, config.amount);
    }
}
