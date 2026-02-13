// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWARevenueVault.sol";
import "../src/InvestorShareToken.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockRegistry.sol";
import "./mocks/MockCashFlowLogic.sol";

contract RWARevenueVaultTest is Test {
    address owner = makeAddr("owner");
    address investor1 = makeAddr("investor1");
    address investor2 = makeAddr("investor2");
    address agent = makeAddr("agent");

    MockRegistry registry;
    MockERC20 paymentToken;
    MockCashFlowLogic logic;
    RWARevenueVault vault;
    InvestorShareToken token;

    uint256 constant ASSET_ID = 1;

    function setUp() public {
        registry = new MockRegistry();
        registry.setWhitelisted(owner, true);
        registry.setWhitelisted(investor1, true);
        registry.setWhitelisted(investor2, true);
        registry.setWhitelisted(agent, true);

        paymentToken = new MockERC20("USD Coin", "USDC");
        paymentToken.mint(owner, 10_000 ether);

        logic = new MockCashFlowLogic(1000 ether);

        vault = new RWARevenueVault();
        vault.initialize(
            owner,
            agent,
            address(logic),
            address(paymentToken),
            address(registry),
            ASSET_ID,
            owner
        );

        token = new InvestorShareToken(
            ASSET_ID,
            "RWA Asset #1",
            "RWA1",
            1000 ether,
            address(registry),
            address(vault),
            owner
        );

        vm.prank(owner);
        vault.setTokenContracts(address(token));
    }

    // -------------------------------------------------
    // InvestorShareToken
    // -------------------------------------------------

    function testOnlyVaultCanMint() public {
        vm.prank(investor1);
        vm.expectRevert();
        token.mint(investor1, 100);
    }

    function testMintsWithinMaxSupply() public {
        vm.prank(owner);
        vault.mintShares(investor1, 500);
        assertEq(token.totalSupply(), 500);
    }

    function testRejectsMintAboveMaxSupply() public {
        vm.prank(owner);
        vm.expectRevert("Max supply exceeded");
        vault.mintShares(investor1, 2000 ether);
    }

    // -------------------------------------------------
    // Revenue flow
    // -------------------------------------------------

    function testDepositsRevenueIntoIdleBalance() public {
        vm.prank(owner);
        paymentToken.transfer(agent, 1000);

        vm.prank(agent);
        paymentToken.approve(address(vault), 1000);

        vm.prank(agent);
        vault.depositRevenue(agent, 1000);

        assertEq(vault.getAvailableForDeployment(), 1000);
    }

    function testCommitsDistributionAndUpdatesIndex() public {
        vm.prank(owner);
        vault.mintShares(investor1, 100);

        vm.prank(owner);
        paymentToken.transfer(agent, 1000 ether);

        vm.prank(agent);
        paymentToken.approve(address(vault), 1000 ether);

        vm.prank(agent);
        vault.depositRevenue(agent, 1000 ether);

        assertEq(vault.distributionStarted(), false);

        vm.prank(agent);
        vault.commitToDistribution(1000 ether);

        assertGt(vault.getAvailableForInvestors(), 0);
        assertGt(vault.cumulativeRewardPerToken(), 0);
        assertEq(vault.distributionStarted(), true);
    }

    // -------------------------------------------------
    // claimYield()
    // -------------------------------------------------

    function testAllowsInvestorToClaimYieldOnce() public {
        vm.prank(owner);
        vault.mintShares(investor1, 100);

        vm.prank(owner);
        paymentToken.transfer(agent, 1000 ether);

        vm.prank(agent);
        paymentToken.approve(address(vault), 1000 ether);

        vm.prank(agent);
        vault.depositRevenue(agent, 1000 ether);

        vm.prank(agent);
        vault.commitToDistribution(1000 ether);

        uint256 expectedReward = 975 ether;
        uint256 beforeBal = paymentToken.balanceOf(investor1);

        vm.prank(investor1);
        vault.claimYield();

        uint256 afterBal = paymentToken.balanceOf(investor1);
        assertEq(afterBal - beforeBal, expectedReward);
    }

    function testPreventsDoubleClaiming() public {
        vm.prank(owner);
        vault.mintShares(investor1, 100);

        vm.prank(owner);
        paymentToken.transfer(agent, 1000 ether);

        vm.prank(agent);
        paymentToken.approve(address(vault), 1000 ether);

        vm.prank(agent);
        vault.depositRevenue(agent, 1000 ether);

        vm.prank(agent);
        vault.commitToDistribution(1000 ether);

        vm.prank(investor1);
        vault.claimYield();

        vm.prank(investor1);
        vm.expectRevert("No pending rewards");
        vault.claimYield();
    }

    // -------------------------------------------------
    // Lifecycle enforcement
    // -------------------------------------------------

    function testBlocksClaimsWhenAssetInactive() public {
        registry.setAssetActive(false);

        vm.prank(investor1);
        vm.expectRevert("Asset not active");
        vault.claimYield();
    }
}
