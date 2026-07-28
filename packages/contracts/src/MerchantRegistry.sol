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
    mapping(address admin => address merchant) private _merchantForAdmin;
    mapping(address merchant => address pendingAdmin) private _pendingAdmins;

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
    error AdminTransferAlreadyPending();
    error AdminTransferNotPending();
    error AdminAlreadyControlsMerchant();
    error UnauthorizedPendingAdmin();

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
    event MerchantAdminTransferProposed(
        address indexed merchant, address indexed currentAdmin, address indexed pendingAdmin
    );
    event MerchantAdminTransferCancelled(
        address indexed merchant, address indexed currentAdmin, address indexed cancelledAdmin
    );
    event MerchantAdminTransferred(address indexed merchant, address indexed previousAdmin, address indexed newAdmin);

    modifier onlyMerchantAdmin() {
        address merchantId = _merchantForAdmin[msg.sender];
        if (merchantId == address(0)) revert MerchantNotRegistered();
        if (_merchants[merchantId].admin != msg.sender) revert UnauthorizedMerchantAdmin();
        _;
    }

    /// @notice Registers the caller as a merchant admin.
    /// @param payoutAddress Address that receives the default 100% split.
    /// @param delegatedSigner Dedicated EOA or ERC-1271 contract that signs
    /// EIP-712 payment intents.
    function registerMerchant(address payoutAddress, address delegatedSigner) external {
        if (_merchantForAdmin[msg.sender] != address(0) || _merchants[msg.sender].admin != address(0)) {
            revert AlreadyRegistered();
        }
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
        _merchantForAdmin[msg.sender] = msg.sender;

        emit MerchantRegistered(msg.sender, payoutAddress, delegatedSigner, timestamp);
    }

    /// @notice Proposes a new admin while preserving the stable merchant
    /// identity used by signed intents, splits, payments, and refunds.
    /// @dev This is a planned two-step rotation, not a lost-key recovery path.
    function proposeAdmin(address newAdmin) external onlyMerchantAdmin {
        address merchantId = _merchantForAdmin[msg.sender];
        if (newAdmin == address(0)) revert ZeroAddress();
        if (newAdmin == msg.sender) revert AdminAlreadyControlsMerchant();
        if (_merchantForAdmin[newAdmin] != address(0) || _merchants[newAdmin].admin != address(0)) {
            revert AdminAlreadyControlsMerchant();
        }
        Merchant storage merchant = _merchants[merchantId];
        if (newAdmin == merchant.delegatedSigner) revert RoleSeparationRequired();
        if (_pendingAdmins[merchantId] != address(0)) revert AdminTransferAlreadyPending();
        _pendingAdmins[merchantId] = newAdmin;
        merchant.updatedAt = uint64(block.timestamp);
        emit MerchantAdminTransferProposed(merchantId, msg.sender, newAdmin);
    }

    /// @notice Cancels an unaccepted admin transfer.
    function cancelAdminTransfer() external onlyMerchantAdmin {
        address merchantId = _merchantForAdmin[msg.sender];
        address pending = _pendingAdmins[merchantId];
        if (pending == address(0)) revert AdminTransferNotPending();
        delete _pendingAdmins[merchantId];
        _merchants[merchantId].updatedAt = uint64(block.timestamp);
        emit MerchantAdminTransferCancelled(merchantId, msg.sender, pending);
    }

    /// @notice Accepts admin control for a stable merchant identity.
    function acceptAdmin(address merchantId) external {
        if (_pendingAdmins[merchantId] != msg.sender) revert UnauthorizedPendingAdmin();
        if (_merchantForAdmin[msg.sender] != address(0) || _merchants[msg.sender].admin != address(0)) {
            revert AdminAlreadyControlsMerchant();
        }
        Merchant storage merchant = _merchants[merchantId];
        if (merchant.admin == address(0)) revert MerchantNotRegistered();
        if (msg.sender == merchant.delegatedSigner) revert RoleSeparationRequired();
        address previous = merchant.admin;
        delete _merchantForAdmin[previous];
        delete _pendingAdmins[merchantId];
        _merchantForAdmin[msg.sender] = merchantId;
        merchant.admin = msg.sender;
        merchant.updatedAt = uint64(block.timestamp);
        emit MerchantAdminTransferred(merchantId, previous, msg.sender);
    }

    /// @notice Updates the recipient of the default split.
    function updatePayoutAddress(address newPayoutAddress) external onlyMerchantAdmin {
        if (newPayoutAddress == address(0)) revert ZeroAddress();
        address merchantId = _merchantForAdmin[msg.sender];
        Merchant storage merchant = _merchants[merchantId];
        if (newPayoutAddress == merchant.delegatedSigner) revert RoleSeparationRequired();
        address previous = merchant.payoutAddress;
        merchant.payoutAddress = newPayoutAddress;
        merchant.updatedAt = uint64(block.timestamp);
        emit PayoutAddressUpdated(merchantId, previous, newPayoutAddress);
    }

    /// @notice Replaces the dedicated payment-intent signer.
    function rotateDelegatedSigner(address newSigner) external onlyMerchantAdmin {
        if (newSigner == address(0)) revert ZeroAddress();
        address merchantId = _merchantForAdmin[msg.sender];
        Merchant storage merchant = _merchants[merchantId];
        if (newSigner == msg.sender || newSigner == merchant.payoutAddress || newSigner == merchant.refundOperator) {
            revert RoleSeparationRequired();
        }
        address previous = merchant.delegatedSigner;
        merchant.delegatedSigner = newSigner;
        merchant.updatedAt = uint64(block.timestamp);
        emit DelegatedSignerRotated(merchantId, previous, newSigner);
    }

    /// @notice Revokes the delegated signer and invalidates all unsigned or
    /// pending intents from that signer.
    function revokeDelegatedSigner() external onlyMerchantAdmin {
        address merchantId = _merchantForAdmin[msg.sender];
        Merchant storage merchant = _merchants[merchantId];
        address previous = merchant.delegatedSigner;
        if (previous == address(0)) revert SignerAlreadyRevoked();
        merchant.delegatedSigner = address(0);
        merchant.updatedAt = uint64(block.timestamp);
        emit DelegatedSignerRevoked(merchantId, previous);
    }

    /// @notice Sets an optional operator that may initiate merchant-funded
    /// refunds. The operator cannot modify any other merchant setting.
    function setRefundOperator(address newOperator) external onlyMerchantAdmin {
        if (newOperator == address(0)) revert ZeroAddress();
        address merchantId = _merchantForAdmin[msg.sender];
        Merchant storage merchant = _merchants[merchantId];
        if (newOperator == merchant.delegatedSigner) revert RoleSeparationRequired();
        address previous = merchant.refundOperator;
        merchant.refundOperator = newOperator;
        merchant.updatedAt = uint64(block.timestamp);
        emit RefundOperatorUpdated(merchantId, previous, newOperator);
    }

    /// @notice Revokes the current refund operator.
    function revokeRefundOperator() external onlyMerchantAdmin {
        address merchantId = _merchantForAdmin[msg.sender];
        Merchant storage merchant = _merchants[merchantId];
        address previous = merchant.refundOperator;
        if (previous == address(0)) revert RefundOperatorAlreadyRevoked();
        merchant.refundOperator = address(0);
        merchant.updatedAt = uint64(block.timestamp);
        emit RefundOperatorUpdated(merchantId, previous, address(0));
    }

    /// @notice Pauses new payments for the caller's merchant account.
    function pauseMerchant() external onlyMerchantAdmin {
        address merchantId = _merchantForAdmin[msg.sender];
        Merchant storage merchant = _merchants[merchantId];
        if (!merchant.active) revert MerchantAlreadyPaused();
        merchant.active = false;
        merchant.updatedAt = uint64(block.timestamp);
        emit MerchantStatusChanged(merchantId, false);
    }

    /// @notice Re-enables new payments for the caller's merchant account.
    function reactivateMerchant() external onlyMerchantAdmin {
        address merchantId = _merchantForAdmin[msg.sender];
        Merchant storage merchant = _merchants[merchantId];
        if (merchant.active) revert MerchantAlreadyActive();
        merchant.active = true;
        merchant.updatedAt = uint64(block.timestamp);
        emit MerchantStatusChanged(merchantId, true);
    }

    /// @notice Creates an immutable settlement split.
    /// @dev Split IDs cannot be overwritten. To change a split, disable it and
    /// create a new ID. This prevents a valid outstanding intent from being
    /// redirected after it was signed.
    function createSplitTemplate(bytes32 splitId, address[] calldata recipients, uint16[] calldata basisPoints)
        external
        onlyMerchantAdmin
    {
        address merchantId = _merchantForAdmin[msg.sender];
        if (splitId == DEFAULT_SPLIT_ID) revert ReservedSplitId();
        if (_splits[merchantId][splitId].exists) revert SplitAlreadyExists();

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

        SplitTemplate storage split = _splits[merchantId][splitId];
        split.recipients = recipients;
        split.basisPoints = basisPoints;
        split.enabled = true;
        split.exists = true;
        _splitIds[merchantId].push(splitId);
        _merchants[merchantId].updatedAt = uint64(block.timestamp);

        emit SplitTemplateCreated(merchantId, splitId, recipients, basisPoints);
    }

    /// @notice Permanently disables a split template.
    function disableSplitTemplate(bytes32 splitId) external onlyMerchantAdmin {
        address merchantId = _merchantForAdmin[msg.sender];
        if (splitId == DEFAULT_SPLIT_ID) revert ReservedSplitId();
        SplitTemplate storage split = _splits[merchantId][splitId];
        if (!split.exists) revert SplitNotFound();
        if (!split.enabled) revert SplitAlreadyDisabled();
        split.enabled = false;
        _merchants[merchantId].updatedAt = uint64(block.timestamp);
        emit SplitTemplateDisabled(merchantId, splitId);
    }

    /// @inheritdoc IMerchantRegistry
    function getMerchant(address merchant) external view returns (Merchant memory) {
        return _merchants[merchant];
    }

    /// @inheritdoc IMerchantRegistry
    function merchantForAdmin(address admin) external view returns (address) {
        return _merchantForAdmin[admin];
    }

    /// @inheritdoc IMerchantRegistry
    function pendingAdmin(address merchant) external view returns (address) {
        return _pendingAdmins[merchant];
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
