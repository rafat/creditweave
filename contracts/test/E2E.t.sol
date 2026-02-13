// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWAAssetRegistry.sol";
import "../src/RentalCashFlowLogic.sol";
import "../src/RWARevenueVault.sol";
import "../src/InvestorShareToken.sol";
import "./mocks/MockERC20.sol";

contract E2ERentalLifecycleTest is Test {
    address admin = makeAddr("admin");
    address factory = makeAddr("factory");
    address compliance = makeAddr("compliance");
    address paymentCollector = makeAddr("paymentCollector");
    address tenant = makeAddr("tenant");
    address investor = makeAddr("investor");
    address agent = makeAddr("agent");

    RWAAssetRegistry registry;
    RentalCashFlowLogic logic;
    RWARevenueVault vault;
    InvestorShareToken token;
    MockERC20 usdc;

    uint256 assetId;
    uint256 rent;
    uint256 interval;
    uint256 graceUnits;
    uint256 firstDue;
    uint256 constant DAY = 1 days;

    function setUp() public {
        registry = new RWAAssetRegistry(admin);

        vm.startPrank(admin);
        registry.grantRole(registry.ASSET_FACTORY_ROLE(), factory);
        registry.grantRole(registry.COMPLIANCE_ROLE(), compliance);
        registry.grantRole(registry.PAYMENT_COLLECTOR_ROLE(), paymentCollector);
        vm.stopPrank();

        vm.prank(compliance);
        registry.verifyKYC(factory);
        vm.prank(compliance);
        registry.verifyKYC(investor);
        vm.prank(compliance);
        registry.whitelistRecipient(investor);

        usdc = new MockERC20("USD Coin", "USDC");
        usdc.mint(tenant, 10_000 ether);

        vm.prank(factory);
        assetId = registry.registerAsset(
            RWACommonTypes.AssetType(0),
            factory,
            1_000_000,
            "ipfs://test"
        );

        logic = new RentalCashFlowLogic();
        rent = 1000 ether;
        interval = 30 * DAY;
        graceUnits = 5;
        firstDue = block.timestamp + 60;
        uint256 leaseEnd = firstDue + 6 * interval;

        bytes memory initData = abi.encode(
            rent,
            interval,
            firstDue,
            graceUnits,
            leaseEnd,
            DAY,
            address(registry)
        );
        logic.initialize(initData);

        vault = new RWARevenueVault();
        vault.initialize(
            admin,
            agent,
            address(logic),
            address(usdc),
            address(registry),
            assetId,
            admin
        );

        vm.prank(admin);
        vault.grantRole(vault.PAYMENT_ROLE(), paymentCollector);

        token = new InvestorShareToken(
            assetId,
            "RWA SG Office",
            "RWA-SG",
            1000 ether,
            address(registry),
            address(vault),
            admin
        );

        vm.prank(admin);
        vault.setTokenContracts(address(token));

        vm.prank(factory);
        registry.linkContracts(assetId, address(logic), address(vault), address(token));

        vm.prank(compliance);
        registry.activateAsset(assetId);

        vm.prank(admin);
        vault.mintShares(investor, 100 ether);
    }

    function testRunsFullRentalLifecycle() public {
        vm.prank(tenant);
        usdc.approve(address(vault), rent);

        vm.prank(paymentCollector);
        vault.depositRevenue(tenant, rent);

        vm.prank(paymentCollector);
        registry.recordPayment(assetId, rent);

        vm.prank(paymentCollector);
        vault.commitToDistribution(rent);

        uint256 beforeBal = usdc.balanceOf(investor);
        vm.prank(investor);
        vault.claimYield();
        uint256 afterBal = usdc.balanceOf(investor);
        assertGt(afterBal, beforeBal);

        uint256 t1 = firstDue + interval + graceUnits * DAY + 1;
        vm.warp(t1);
        registry.checkAndTriggerDefault(assetId);

        uint256 t2 = firstDue + 2 * interval + graceUnits * DAY + 1;
        vm.warp(t2);
        registry.checkAndTriggerDefault(assetId);

        (, , , RWACommonTypes.AssetStatus status, ,) = registry.getAssetCore(assetId);
        assertEq(uint256(status), uint256(RWACommonTypes.AssetStatus.DEFAULTED));
    }
}
