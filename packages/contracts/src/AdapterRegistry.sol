// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IAdapterRegistry} from "./interfaces/IAdapterRegistry.sol";

/// @title GiwaPay exact-output adapter registry
/// @notice Allow-lists pinned adapter bytecode, token pairs and per-input
/// token caps. Runtime code is checked on every payment and bytecode containing
/// the DELEGATECALL opcode is rejected at registration.
contract AdapterRegistry is IAdapterRegistry, Ownable2Step, Pausable {
    bytes32 public constant ADAPTER_MANAGER_ROLE = keccak256("ADAPTER_MANAGER_ROLE");

    struct AdapterConfig {
        bool enabled;
        bool testOnly;
        bytes32 runtimeCodeHash;
        string identifier;
    }

    bool public immutable productionMode;

    mapping(address account => bool enabled) public adapterManagers;
    mapping(address adapter => AdapterConfig config) private _adapters;
    mapping(address adapter => mapping(address tokenIn => mapping(address tokenOut => bool supported))) public
        supportedPairs;
    mapping(address adapter => mapping(address tokenIn => uint256 cap)) public tokenInputCaps;

    error UnauthorizedAdapterManager();
    error ZeroAddress();
    error AdapterHasNoCode();
    error AdapterDelegatecallForbidden();
    error AdapterAlreadyRegistered();
    error AdapterNotRegistered();
    error EmptyIdentifier();
    error TestAdapterForbiddenInProduction();
    error AdapterDisabled();
    error AdapterCodeHashMismatch();
    error AdapterCodeHashUnchanged();
    error UnsupportedTokenPair();
    error InputCapNotConfigured();
    error MaximumInputCapExceeded();
    error InvalidTokenPair();

    event AdapterManagerUpdated(address indexed account, bool enabled);
    event AdapterRegistered(address indexed adapter, bytes32 indexed runtimeCodeHash, string identifier, bool testOnly);
    event AdapterEnabledChanged(address indexed adapter, bool enabled);
    event AdapterDisabledForCodeHashMismatch(
        address indexed adapter, bytes32 indexed expectedCodeHash, bytes32 indexed actualCodeHash
    );
    event TokenPairSupportUpdated(
        address indexed adapter, address indexed tokenIn, address indexed tokenOut, bool supported
    );
    event TokenInputCapUpdated(address indexed adapter, address indexed tokenIn, uint256 cap);

    modifier onlyAdapterManager() {
        if (msg.sender != owner() && !adapterManagers[msg.sender]) {
            revert UnauthorizedAdapterManager();
        }
        _;
    }

    constructor(address initialOwner, address initialAdapterManager, bool productionMode_) Ownable(initialOwner) {
        if (initialAdapterManager == address(0)) revert ZeroAddress();
        productionMode = productionMode_;
        adapterManagers[initialAdapterManager] = true;
        emit AdapterManagerUpdated(initialAdapterManager, true);
    }

    /// @notice Grants or revokes the adapter-manager role.
    function setAdapterManager(address account, bool enabled) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        adapterManagers[account] = enabled;
        emit AdapterManagerUpdated(account, enabled);
    }

    /// @notice Accepts a pending ownership transfer and removes any adapter
    /// manager authority retained by the previous owner.
    function acceptOwnership() public override {
        address previousOwner = owner();
        super.acceptOwnership();
        if (adapterManagers[previousOwner]) {
            adapterManagers[previousOwner] = false;
            emit AdapterManagerUpdated(previousOwner, false);
        }
    }

    /// @notice Registers an adapter and pins its current runtime bytecode.
    function registerAdapter(address adapter, string calldata identifier, bool testOnly) external onlyAdapterManager {
        if (adapter == address(0)) revert ZeroAddress();
        if (adapter.code.length == 0) revert AdapterHasNoCode();
        if (_containsDelegatecall(adapter)) revert AdapterDelegatecallForbidden();
        if (_adapters[adapter].runtimeCodeHash != bytes32(0)) revert AdapterAlreadyRegistered();
        if (bytes(identifier).length == 0) revert EmptyIdentifier();
        if (productionMode && testOnly) revert TestAdapterForbiddenInProduction();

        bytes32 runtimeCodeHash = adapter.codehash;
        _adapters[adapter] = AdapterConfig({
            enabled: true, testOnly: testOnly, runtimeCodeHash: runtimeCodeHash, identifier: identifier
        });

        emit AdapterRegistered(adapter, runtimeCodeHash, identifier, testOnly);
    }

    /// @notice Enables or disables a registered adapter.
    function setAdapterEnabled(address adapter, bool enabled) external onlyAdapterManager {
        AdapterConfig storage config = _registeredAdapter(adapter);
        if (enabled) {
            if (adapter.code.length == 0 || adapter.codehash != config.runtimeCodeHash) {
                revert AdapterCodeHashMismatch();
            }
            if (productionMode && config.testOnly) revert TestAdapterForbiddenInProduction();
        }
        config.enabled = enabled;
        emit AdapterEnabledChanged(adapter, enabled);
    }

    /// @notice Configures one supported exact-output token pair.
    function setPairSupport(address adapter, address tokenIn, address tokenOut, bool supported)
        external
        onlyAdapterManager
    {
        _registeredAdapter(adapter);
        if (tokenIn == address(0) || tokenOut == address(0) || tokenIn == tokenOut) {
            revert InvalidTokenPair();
        }
        supportedPairs[adapter][tokenIn][tokenOut] = supported;
        emit TokenPairSupportUpdated(adapter, tokenIn, tokenOut, supported);
    }

    /// @notice Configures the largest `maxAmountIn` a payer may authorize for
    /// an adapter and input token. Setting zero disables all routes using it.
    function setTokenInputCap(address adapter, address tokenIn, uint256 cap) external onlyAdapterManager {
        _registeredAdapter(adapter);
        if (tokenIn == address(0)) revert ZeroAddress();
        tokenInputCaps[adapter][tokenIn] = cap;
        emit TokenInputCapUpdated(adapter, tokenIn, cap);
    }

    /// @notice Persists an emergency disable when deployed runtime bytecode no
    /// longer matches the registered hash. Anyone may call this sentinel.
    /// @dev PaymentRouter independently rejects a mismatch even before this
    /// function is called.
    function disableChangedAdapter(address adapter) external {
        AdapterConfig storage config = _registeredAdapter(adapter);
        bytes32 actualCodeHash = adapter.codehash;
        if (adapter.code.length != 0 && actualCodeHash == config.runtimeCodeHash) {
            revert AdapterCodeHashUnchanged();
        }
        config.enabled = false;
        emit AdapterDisabledForCodeHashMismatch(adapter, config.runtimeCodeHash, actualCodeHash);
    }

    /// @notice Stops all adapter-routed payments. Direct-token payments do not
    /// consult this registry and remain available.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes adapter validation.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc IAdapterRegistry
    function validateAdapter(address adapter, address tokenIn, address tokenOut, uint256 maxAmountIn) external view {
        _requireNotPaused();
        AdapterConfig storage config = _adapters[adapter];
        if (config.runtimeCodeHash == bytes32(0)) revert AdapterNotRegistered();
        if (!config.enabled) revert AdapterDisabled();
        if (productionMode && config.testOnly) revert TestAdapterForbiddenInProduction();
        if (adapter.code.length == 0 || adapter.codehash != config.runtimeCodeHash) {
            revert AdapterCodeHashMismatch();
        }
        if (!supportedPairs[adapter][tokenIn][tokenOut]) revert UnsupportedTokenPair();

        uint256 cap = tokenInputCaps[adapter][tokenIn];
        if (cap == 0) revert InputCapNotConfigured();
        if (maxAmountIn > cap) revert MaximumInputCapExceeded();
    }

    /// @notice Returns the complete adapter metadata.
    function getAdapter(address adapter) external view returns (AdapterConfig memory) {
        return _adapters[adapter];
    }

    function _registeredAdapter(address adapter) private view returns (AdapterConfig storage config) {
        config = _adapters[adapter];
        if (config.runtimeCodeHash == bytes32(0)) revert AdapterNotRegistered();
    }

    /// @dev Scans executable opcodes while skipping PUSH immediate data. This
    /// rejects delegatecall-based proxies and adapters that delegate execution
    /// into mutable external implementations.
    function _containsDelegatecall(address adapter) private view returns (bool) {
        uint256 length = adapter.code.length;
        bytes memory runtime = new bytes(length);
        assembly ("memory-safe") {
            extcodecopy(adapter, add(runtime, 0x20), 0, length)
        }

        uint256 index;
        while (index < length) {
            uint8 opcode = uint8(runtime[index]);
            if (opcode == 0xf4) return true;
            unchecked {
                if (opcode >= 0x60 && opcode <= 0x7f) {
                    index += uint256(opcode) - 0x5e;
                } else {
                    ++index;
                }
            }
        }
        return false;
    }
}
