// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWARevenueVault.sol";
import "../src/InvestorShareToken.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockRegistry.sol";
import "./mocks/MockCashFlowLogic.sol";

contract IntegrationsTest is Test {
    address admin = makeAddr("admin");
    address investorA = makeAddr("investorA");
    address investorB = makeAddr("investorB");
    address tenant = makeAddr("tenant");
    address agent = makeAddr("agent");

    MockERC20 usdc;
    MockRegistry registry;
    MockCashFlowLogic logic;
    RWARevenueVault vault;
    InvestorShareToken token;

    uint256 constant ASSET_ID = 1;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        usdc.mint(tenant, 10_000 ether);

        registry = new MockRegistry();
        registry.setWhitelisted(investorA, true);
        registry.setWhitelisted(investorB, true);
        registry.setWhitelisted(admin, true);

        logic = new MockCashFlowLogic(1000 ether);

        vault = new RWARevenueVault();
        vault.initialize(
            admin,
            agent,
            address(logic),
            address(usdc),
            address(registry),
            ASSET_ID,
            admin
        );

        token = new InvestorShareToken(
            ASSET_ID,
            "RWA Token",
            "RWA",
            1000 ether,
            address(registry),
            address(vault),
            admin
        );

        vm.prank(admin);
        vault.setTokenContracts(address(token));

        vm.prank(admin);
        vault.mintShares(investorA, 600 ether);

        vm.prank(admin);
        vault.mintShares(investorB, 400 ether);
    }

    function _fundAndCommit() internal {
        vm.prank(tenant);
        usdc.transfer(agent, 1000 ether);

        vm.prank(agent);
        usdc.approve(address(vault), 1000 ether);

        vm.prank(agent);
        vault.depositRevenue(agent, 1000 ether);

        vm.prank(agent);
        vault.commitToDistribution(1000 ether);
    }

    function testDistributesYieldProRataAcrossInvestors() public {
        _fundAndCommit();

        vm.prank(investorA);
        vault.claimYield();

        vm.prank(investorB);
        vault.claimYield();

        assertEq(usdc.balanceOf(investorA), 585 ether);
        assertEq(usdc.balanceOf(investorB), 390 ether);
    }

    function testClaimOrderDoesNotAffectPayouts() public {
        _fundAndCommit();

        vm.prank(investorB);
        vault.claimYield();

        vm.prank(investorA);
        vault.claimYield();

        assertEq(usdc.balanceOf(investorA), 585 ether);
        assertEq(usdc.balanceOf(investorB), 390 ether);
    }
}
