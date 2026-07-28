// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMerchantRegistry} from "./interfaces/IMerchantRegistry.sol";

/// @title GiwaPay merchant registry
/// @notice Stores merchant-controlled payout settings and immutable split
/// templates. A delegated signer is intentionally limited to signing payment
/// intents; every state-changing function is restricted to the merchant admin.
contract MerchantRegistry is IMerchantRegistry {
    uint256 public constant MAX_SPLIT_RECIPIENTS = 8;
    uint16 public constant BASIS_POINTS = 10_000;
    bytes32 public constant DEFAULT_SPLIT_ID = bytes32(0);

    struct SplitTemplate {
        address[] recipients;
        uint16[] basisPoints;
        bool enabled;
        bool exists;
    }

    mapping(address merchant => Merchant record) private _merchants;
    mapping(address merchant => mapping(bytes32 splitId => SplitTemplate template)) private _splits;
    mapping(address merchant => bytes32[] splitIds) private _splitIds;

    error AlreadyRegistered();
    error MerchantNotRegistered();
    error UnauthorizedMerchantAdmin();
    error ZeroAddress();
    error RoleSeparationRequired();
    error SignerAlreadyRevoked();
    error RefundOperatorAlreadyRevoked();
    error MerchantAlreadyPaused();
    error MerchantAlreadyActive();
    error ReservedSplitId();
    error SplitAlreadyExists();
    error SplitNotFound();
    error SplitAlreadyDisabled();
    error InvalidSplitLength();
    error ZeroBasisPoints();
    error InvalidBasisPointsTotal();
    error DuplicateRecipient();

    event MerchantRegistered(
        address indexed merchant, address indexed payoutAddress, address indexed delegatedSigner, uint64 registeredAt
    );
    event PayoutAddressUpdated(
        address indexed merchant, address indexed previousPayoutAddress, address indexed newPayoutAddress
    );
    event DelegatedSignerRotated(address indexed merchant, address indexed previousSigner, address indexed newSigner);
    event DelegatedSignerRevoked(address indexed merchant, address indexed previousSigner);
    event RefundOperatorUpdated(
        address indexed merchant, address indexed previousOperator, address indexed newOperator
    );
    event MerchantStatusChanged(address indexed merchant, bool active);
    event SplitTemplateCreated(
        address indexed merchant, bytes32 indexed splitId, address[] recipients, uint16[] basisPoints
    );
    event SplitTemplateDisabled(address indexed merchant, bytes32 indexed splitId);

    modifier onlyMerchantAdmin() {
        Merchant storage merchant = _merchants[msg.sender];
        if (merchant.admin == address(0)) revert MerchantNotRegistered();
        if (merchant.admin != msg.sender) revert UnauthorizedMerchantAdmin();
        _;
    }

    /// @notice Registers the caller as a merchant admin.
    /// @param payoutAddress Address that receives the default 100% split.
    /// @param delegatedSigner Dedicated EOA that signs EIP-712 payment intents.
    function registerMerchant(address payoutAddress, address delegatedSigner) external {
        if (_merchants[msg.sender].admin != address(0)) revert AlreadyRegistered();
        if (payoutAddress == address(0) || delegatedSigner == address(0)) revert ZeroAddress();
        if (delegatedSigner == msg.sender || delegatedSigner == payoutAddress) {
            revert RoleSeparationRequired();
        }

        uint64 timestamp = uint64(block.timestamp);
        _merchants[msg.sender] = Merchant({
            admin: msg.sender,
            payoutAddress: payoutAddress,
            delegatedSigner: delegatedSigner,
            refundOperator: address(0),
            active: true,
            createdAt: timestamp,
            updatedAt: timestamp
        });

        emit MerchantRegistered(msg.sender, payoutAddress, delegatedSigner, timestamp);
    }

    /// @notice Updates the recipient of the default split.
    function updatePayoutAddress(address newPayoutAddress) external onlyMerchantAdmin {
        if (newPayoutAddress == address(0)) revert ZeroAddress();
        Merchant storage merchant = _merchants[msg.sender];
        if (newPayoutAddress == merchant.delegatedSigner) revert RoleSeparationRequired();
        address previous = merchant.payoutAddress;
        merchant.payoutAddress = newPayoutAddress;
        merchant.updatedAt = uint64(block.timestamp);
        emit PayoutAddressUpdated(msg.sender, previous, newPayoutAddress);
    }

    /// @notice Replaces the dedicated payment-intent signer.
    function rotateDelegatedSigner(address newSigner) external onlyMerchantAdmin {
        if (newSigner == address(0)) revert ZeroAddress();
        Merchant storage merchant = _merchants[msg.sender];
        if (newSigner == msg.sender || newSigner == merchant.payoutAddress || newSigner == merchant.refundOperator) {
            revert RoleSeparationRequired();
        }
        address previous = merchant.delegatedSigner;
        merchant.delegatedSigner = newSigner;
        merchant.updatedAt = uint64(block.timestamp);
        emit DelegatedSignerRotated(msg.sender, previous, newSigner);
    }

    /// @notice Revokes the delegated signer and invalidates all unsigned or
    /// pending intents from that signer.
    function revokeDelegatedSigner() external onlyMerchantAdmin {
        Merchant storage merchant = _merchants[msg.sender];
        address previous = merchant.delegatedSigner;
        if (previous == address(0)) revert SignerAlreadyRevoked();
        merchant.delegatedSigner = address(0);
        merchant.updatedAt = uint64(block.timestamp);
        emit DelegatedSignerRevoked(msg.sender, previous);
    }

    /// @notice Sets an optional operator that may initiate merchant-funded
    /// refunds. The operator cannot modify any other merchant setting.
    function setRefundOperator(address newOperator) external onlyMerchantAdmin {
        if (newOperator == address(0)) revert ZeroAddress();
        Merchant storage merchant = _merchants[msg.sender];
        if (newOperator == merchant.delegatedSigner) revert RoleSeparationRequired();
        address previous = merchant.refundOperator;
        merchant.refundOperator = newOperator;
        merchant.updatedAt = uint64(block.timestamp);
        emit RefundOperatorUpdated(msg.sender, previous, newOperator);
    }

    /// @notice Revokes the current refund operator.
    function revokeRefundOperator() external onlyMerchantAdmin {
        Merchant storage merchant = _merchants[msg.sender];
        address previous = merchant.refundOperator;
        if (previous == address(0)) revert RefundOperatorAlreadyRevoked();
        merchant.refundOperator = address(0);
        merchant.updatedAt = uint64(block.timestamp);
        emit RefundOperatorUpdated(msg.sender, previous, address(0));
    }

    /// @notice Pauses new payments for the caller's merchant account.
    function pauseMerchant() external onlyMerchantAdmin {
        Merchant storage merchant = _merchants[msg.sender];
        if (!merchant.active) revert MerchantAlreadyPaused();
        merchant.active = false;
        merchant.updatedAt = uint64(block.timestamp);
        emit MerchantStatusChanged(msg.sender, false);
    }

    /// @notice Re-enables new payments for the caller's merchant account.
    function reactivateMerchant() external onlyMerchantAdmin {
        Merchant storage merchant = _merchants[msg.sender];
        if (merchant.active) revert MerchantAlreadyActive();
        merchant.active = true;
        merchant.updatedAt = uint64(block.timestamp);
        emit MerchantStatusChanged(msg.sender, true);
    }

    /// @notice Creates an immutable settlement split.
    /// @dev Split IDs cannot be overwritten. To change a split, disable it and
    /// create a new ID. This prevents a valid outstanding intent from being
    /// redirected after it was signed.
    function createSplitTemplate(bytes32 splitId, address[] calldata recipients, uint16[] calldata basisPoints)
        external
        onlyMerchantAdmin
    {
        if (splitId == DEFAULT_SPLIT_ID) revert ReservedSplitId();
        if (_splits[msg.sender][splitId].exists) revert SplitAlreadyExists();

        uint256 length = recipients.length;
        if (length == 0 || length > MAX_SPLIT_RECIPIENTS || length != basisPoints.length) {
            revert InvalidSplitLength();
        }

        uint256 total = 0;
        for (uint256 i; i < length; ++i) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (basisPoints[i] == 0) revert ZeroBasisPoints();
            total += basisPoints[i];
            for (uint256 j; j < i; ++j) {
                if (recipients[i] == recipients[j]) revert DuplicateRecipient();
            }
        }
        if (total != BASIS_POINTS) revert InvalidBasisPointsTotal();

        SplitTemplate storage split = _splits[msg.sender][splitId];
        split.recipients = recipients;
        split.basisPoints = basisPoints;
        split.enabled = true;
        split.exists = true;
        _splitIds[msg.sender].push(splitId);
        _merchants[msg.sender].updatedAt = uint64(block.timestamp);

        emit SplitTemplateCreated(msg.sender, splitId, recipients, basisPoints);
    }

    /// @notice Permanently disables a split template.
    function disableSplitTemplate(bytes32 splitId) external onlyMerchantAdmin {
        if (splitId == DEFAULT_SPLIT_ID) revert ReservedSplitId();
        SplitTemplate storage split = _splits[msg.sender][splitId];
        if (!split.exists) revert SplitNotFound();
        if (!split.enabled) revert SplitAlreadyDisabled();
        split.enabled = false;
        _merchants[msg.sender].updatedAt = uint64(block.timestamp);
        emit SplitTemplateDisabled(msg.sender, splitId);
    }

    /// @inheritdoc IMerchantRegistry
    function getMerchant(address merchant) external view returns (Merchant memory) {
        return _merchants[merchant];
    }

    /// @notice Returns the number of custom (non-default) split templates a
    /// merchant has created, including disabled historical templates.
    function splitTemplateCount(address merchant) external view returns (uint256) {
        return _splitIds[merchant].length;
    }

    /// @notice Returns one stable split ID for bounded dashboard enumeration.
    function splitTemplateIdAt(address merchant, uint256 index) external view returns (bytes32) {
        return _splitIds[merchant][index];
    }

    /// @inheritdoc IMerchantRegistry
    function isAuthorizedIntentSigner(address merchant, address signer) external view returns (bool) {
        Merchant storage record = _merchants[merchant];
        return record.active && record.delegatedSigner != address(0) && signer == record.delegatedSigner;
    }

    /// @inheritdoc IMerchantRegistry
    function isAuthorizedRefundOperator(address merchant, address operator) external view returns (bool) {
        Merchant storage record = _merchants[merchant];
        return record.admin != address(0)
            && (operator == record.admin || (record.refundOperator != address(0) && operator == record.refundOperator));
    }

    /// @inheritdoc IMerchantRegistry
    function getSplitTemplate(address merchant, bytes32 splitId)
        external
        view
        returns (address[] memory recipients, uint16[] memory basisPoints, bool enabled)
    {
        Merchant storage record = _merchants[merchant];
        if (record.admin == address(0)) {
            return (new address[](0), new uint16[](0), false);
        }

        if (splitId == DEFAULT_SPLIT_ID) {
            recipients = new address[](1);
            basisPoints = new uint16[](1);
            recipients[0] = record.payoutAddress;
            basisPoints[0] = BASIS_POINTS;
            return (recipients, basisPoints, true);
        }

        SplitTemplate storage split = _splits[merchant][splitId];
        return (split.recipients, split.basisPoints, split.enabled);
    }
}
