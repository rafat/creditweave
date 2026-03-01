// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract LossWaterfall is Ownable {
    struct Bucket {
        uint256 balance;
    }

    Bucket public senior;
    Bucket public junior;
    uint256 public totalLossAbsorbed;

    event CapitalDeposited(address indexed caller, bool indexed isJunior, uint256 amount);
    event LossAbsorbed(
        uint256 requestedLoss,
        uint256 absorbedByJunior,
        uint256 absorbedBySenior,
        uint256 unresolvedLoss
    );

    constructor(address admin) Ownable(admin) {
        require(admin != address(0), "Invalid admin");
    }

    function depositSenior(uint256 amount) external onlyOwner {
        require(amount > 0, "Invalid amount");
        senior.balance += amount;
        emit CapitalDeposited(msg.sender, false, amount);
    }

    function depositJunior(uint256 amount) external onlyOwner {
        require(amount > 0, "Invalid amount");
        junior.balance += amount;
        emit CapitalDeposited(msg.sender, true, amount);
    }

    function absorbLoss(uint256 lossAmount)
        external
        onlyOwner
        returns (
            uint256 absorbedByJunior,
            uint256 absorbedBySenior,
            uint256 unresolvedLoss
        )
    {
        require(lossAmount > 0, "Invalid loss");

        uint256 remaining = lossAmount;

        absorbedByJunior = remaining > junior.balance ? junior.balance : remaining;
        junior.balance -= absorbedByJunior;
        remaining -= absorbedByJunior;

        absorbedBySenior = remaining > senior.balance ? senior.balance : remaining;
        senior.balance -= absorbedBySenior;
        remaining -= absorbedBySenior;

        unresolvedLoss = remaining;
        totalLossAbsorbed += (absorbedByJunior + absorbedBySenior);

        emit LossAbsorbed(lossAmount, absorbedByJunior, absorbedBySenior, unresolvedLoss);
    }
}
