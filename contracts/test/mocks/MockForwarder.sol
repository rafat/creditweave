// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMockReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract MockForwarder {
    function deliver(
        address receiver,
        bytes calldata metadata,
        bytes calldata report
    ) external {
        IMockReceiver(receiver).onReport(metadata, report);
    }
}
