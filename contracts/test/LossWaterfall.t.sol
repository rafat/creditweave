// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/LossWaterfall.sol";

contract LossWaterfallTest is Test {
    LossWaterfall internal waterfall;

    function setUp() public {
        waterfall = new LossWaterfall(address(this));
    }

    function testJuniorAbsorbsFirst() public {
        waterfall.depositJunior(100);
        waterfall.depositSenior(300);

        (uint256 fromJunior, uint256 fromSenior, uint256 unresolved) =
            waterfall.absorbLoss(250);

        assertEq(fromJunior, 100);
        assertEq(fromSenior, 150);
        assertEq(unresolved, 0);
        (uint256 juniorBal) = waterfall.junior();
        (uint256 seniorBal) = waterfall.senior();
        assertEq(juniorBal, 0);
        assertEq(seniorBal, 150);
    }

    function testTracksUnresolvedLossWhenCapitalInsufficient() public {
        waterfall.depositJunior(50);
        waterfall.depositSenior(25);

        (uint256 fromJunior, uint256 fromSenior, uint256 unresolved) =
            waterfall.absorbLoss(200);

        assertEq(fromJunior, 50);
        assertEq(fromSenior, 25);
        assertEq(unresolved, 125);
        assertEq(waterfall.totalLossAbsorbed(), 75);
    }
}
