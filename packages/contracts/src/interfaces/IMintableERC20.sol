// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMintableERC20 {
    function mint(address recipient, uint256 amount) external;
}
