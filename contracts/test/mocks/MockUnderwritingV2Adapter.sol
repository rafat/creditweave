// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockUnderwritingV2Adapter {
    bool public approved = true;
    bool public borrowBlocked = false;
    uint16 public maxLtvBps = 5000;
    uint16 public rateBps = 1000;
    uint256 public creditLimit = type(uint256).max;
    uint256 public expiry = type(uint256).max;
    uint16 public effectiveLtvBps = 5000;

    function setApproved(bool value) external {
        approved = value;
    }

    function setBorrowBlocked(bool value) external {
        borrowBlocked = value;
    }

    function setBorrowingTerms(
        uint16 _maxLtvBps,
        uint16 _rateBps,
        uint256 _creditLimit,
        uint256 _expiry
    ) external {
        maxLtvBps = _maxLtvBps;
        rateBps = _rateBps;
        creditLimit = _creditLimit;
        expiry = _expiry;
    }

    function setEffectiveLtvBps(uint16 value) external {
        effectiveLtvBps = value;
    }

    function isApproved(address, uint256) external view returns (bool) {
        return approved && expiry > block.timestamp;
    }

    function isBorrowBlocked(address, uint256) external view returns (bool) {
        return borrowBlocked;
    }

    function getBorrowingTerms(address, uint256)
        external
        view
        returns (uint16, uint16, uint256, uint256)
    {
        return (maxLtvBps, rateBps, creditLimit, expiry);
    }

    function effectiveMaxLtvBps(address, uint256) external view returns (uint16) {
        return effectiveLtvBps;
    }
}
