// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockAssetRegistry {
    uint256 public assetValue;

    function setAssetValue(uint256 _value) external {
        assetValue = _value;
    }

    function assets(uint256)
        external
        view
        returns (
            uint256,
            uint8,
            address,
            address,
            address,
            address,
            bool,
            bool,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            address,
            uint8,
            uint8,
            uint256,
            uint256,
            string memory
        )
    {
        return (
            0,0,address(0),address(0),address(0),address(0),
            false,false,
            assetValue,
            0,0,0,0,0,0,0,0,0,
            address(0),
            0,0,0,0,""
        );
    }
}
