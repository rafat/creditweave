// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockVault {
    bool public distributionStartedFlag = false;

    function setDistributionStarted(bool status) external {
        distributionStartedFlag = status;
    }

    function distributionStarted() external view returns (bool) {
        return distributionStartedFlag;
    }

    function onTokenTransfer(address, address) external {
        // no-op
    }
}
