// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockNAVOracle {
    mapping(uint256 => uint256) public navs;
    mapping(uint256 => bool) public freshStatus;

    function setNAV(uint256 assetId, uint256 nav) external {
        navs[assetId] = nav;
    }

    function setIsFresh(uint256 assetId, bool isFresh) external {
        freshStatus[assetId] = isFresh;
    }

    function isFresh(uint256 assetId) external view returns (bool) {
        return freshStatus[assetId];
    }

    function getNAVData(uint256 assetId) external view returns (uint256 nav, uint256 updatedAt, bytes32 sourceHash) {
        return (navs[assetId], block.timestamp, bytes32(0));
    }

    function getNAV(uint256 assetId) external view returns (uint256) {
        return navs[assetId];
    }
}