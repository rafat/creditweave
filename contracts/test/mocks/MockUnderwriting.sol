// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockUnderwriting {
    bool public approved;
    uint16 public maxLtvBps;
    uint16 public rateBps;
    uint256 public creditLimit;
    uint256 public expiry;

    function setTerms(
        bool _approved,
        uint16 _ltv,
        uint16 _rate,
        uint256 _expiry
    ) external {
        approved = _approved;
        maxLtvBps = _ltv;
        rateBps = _rate;
        creditLimit = type(uint256).max; // Default to max to not break existing LTV tests
        expiry = _expiry;
    }

    function setTermsWithLimit(
        bool _approved,
        uint16 _ltv,
        uint16 _rate,
        uint256 _limit,
        uint256 _expiry
    ) external {
        approved = _approved;
        maxLtvBps = _ltv;
        rateBps = _rate;
        creditLimit = _limit;
        expiry = _expiry;
    }

    function getTerms(address, uint256)
        external
        view
        returns (bool, uint16, uint16, uint256, uint256, bytes32)
    {
        return (approved, maxLtvBps, rateBps, creditLimit, expiry, bytes32(0));
    }

    function isApproved(address, uint256)
        external
        view
        returns (bool)
    {
        return approved && expiry > block.timestamp;
    }
}
