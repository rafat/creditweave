// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockRegistry {
    bool public assetActive = true;
    bool public assetPaused = false;

    mapping(address => bool) public whitelisted;

    function setAssetActive(bool _active) external {
        assetActive = _active;
    }

    function setAssetPaused(bool _paused) external {
        assetPaused = _paused;
    }

    function setWhitelisted(address user, bool status) external {
        whitelisted[user] = status;
    }

    function isWhitelisted(address recipient) external view returns (bool) {
        return whitelisted[recipient];
    }

    function isAssetPaused(uint256) external view returns (bool) {
        return assetPaused;
    }

    function isAssetActive(uint256) external view returns (bool) {
        return assetActive;
    }
}
