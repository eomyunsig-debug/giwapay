// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMerchantRegistry {
    struct Merchant {
        address admin;
        address payoutAddress;
        address delegatedSigner;
        address refundOperator;
        bool active;
        uint64 createdAt;
        uint64 updatedAt;
    }

    function getMerchant(address merchant) external view returns (Merchant memory);

    function merchantForAdmin(address admin) external view returns (address merchant);

    function pendingAdmin(address merchant) external view returns (address);

    function isAuthorizedIntentSigner(address merchant, address signer) external view returns (bool);

    function isAuthorizedRefundOperator(address merchant, address operator) external view returns (bool);

    function getSplitTemplate(address merchant, bytes32 splitId)
        external
        view
        returns (address[] memory recipients, uint16[] memory basisPoints, bool enabled);
}
