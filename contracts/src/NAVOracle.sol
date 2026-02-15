// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/ReceiverTemplate.sol";

contract NAVOracle is ReceiverTemplate {
    struct NAVData {
        uint256 nav;
        uint256 updatedAt;
        bytes32 sourceHash;
    }

    mapping(uint256 => NAVData) public navData;

    uint256 public maxStaleness = 3 days;

    event NAVUpdated(
        uint256 indexed assetId,
        uint256 nav,
        uint256 timestamp,
        bytes32 sourceHash
    );

    constructor(address forwarder)
        ReceiverTemplate(forwarder)
    {}

    // ------------------------------------------------------------
    // CRE Entry
    // ------------------------------------------------------------

    function _processReport(bytes calldata report) internal override {
        (
            uint256 assetId,
            uint256 nav,
            bytes32 sourceHash
        ) = abi.decode(report, (uint256, uint256, bytes32));

        require(assetId > 0, "Invalid assetId");
        require(nav > 0, "Invalid NAV");

        navData[assetId] = NAVData({
            nav: nav,
            updatedAt: block.timestamp,
            sourceHash: sourceHash
        });

        emit NAVUpdated(assetId, nav, block.timestamp, sourceHash);
    }

    // ------------------------------------------------------------
    // Views
    // ------------------------------------------------------------

    function getNAV(uint256 assetId)
        external
        view
        returns (uint256)
    {
        return navData[assetId].nav;
    }

    function getNAVData(uint256 assetId)
        external
        view
        returns (uint256 nav, uint256 updatedAt, bytes32 sourceHash)
    {
        NAVData storage data = navData[assetId];
        return (data.nav, data.updatedAt, data.sourceHash);
    }

    function isFresh(uint256 assetId)
        external
        view
        returns (bool)
    {
        NAVData storage data = navData[assetId];
        if (data.updatedAt == 0) return false;
        return block.timestamp - data.updatedAt <= maxStaleness;
    }

    function setMaxStaleness(uint256 newWindow) external onlyOwner {
        require(newWindow > 0, "Invalid window");
        maxStaleness = newWindow;
    }
}
