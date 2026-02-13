// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWAAssetRegistry.sol";
import "../src/interface/ICashFlowLogic.sol";
import "./mocks/MockCashFlowLogic.sol";

contract RWAAssetRegistryTest is Test {
    RWAAssetRegistry registry;

    address admin = makeAddr("admin");
    address factory = makeAddr("factory");
    address compliance = makeAddr("compliance");
    address payment = makeAddr("payment");

    function getOriginator(uint256 assetId) internal view returns (address originator) {
        (, , originator, , ,) = registry.getAssetCore(assetId);
    }

    function getCurrentStatus(uint256 assetId) internal view returns (RWACommonTypes.AssetStatus status) {
        (, , , status, ,) = registry.getAssetCore(assetId);
    }

    function getScheduleFields(uint256 assetId)
        internal
        view
        returns (uint256 nextPaymentDueDate, uint256 expectedMonthlyPayment, uint256 expectedMaturityDate)
    {
        return registry.getAssetSchedule(assetId);
    }

    function setUp() public {
        registry = new RWAAssetRegistry(admin);

        vm.startPrank(admin);
        registry.grantRole(registry.ASSET_FACTORY_ROLE(), factory);
        registry.grantRole(registry.COMPLIANCE_ROLE(), compliance);
        registry.grantRole(registry.PAYMENT_COLLECTOR_ROLE(), payment);
        vm.stopPrank();

        vm.prank(compliance);
        registry.verifyKYC(factory);
    }

    // -------------------------------------------------
    // Registration
    // -------------------------------------------------

    function testRegisterAsset() public {
        vm.prank(factory);
        uint256 assetId = registry.registerAsset(
            RWACommonTypes.AssetType(0),
            factory,
            1_000_000,
            "ipfs://test"
        );

        assertEq(getOriginator(assetId), factory);
    }

    // -------------------------------------------------
    // Activation
    // -------------------------------------------------

    function testActivateAssetAfterComplianceApproval() public {
        vm.prank(factory);
        uint256 assetId = registry.registerAsset(
            RWACommonTypes.AssetType(0),
            factory,
            1_000,
            "ipfs"
        );

        address logic = makeAddr("logic");
        address vault = makeAddr("vault");
        address token = makeAddr("token");

        vm.prank(factory);
        registry.linkContracts(assetId, logic, vault, token);

        vm.prank(compliance);
        registry.activateAsset(assetId);

        assertEq(uint256(getCurrentStatus(assetId)), uint256(RWACommonTypes.AssetStatus.ACTIVE));

        (address linkedLogic, address linkedVault, address linkedToken) = registry.getAssetLinks(assetId);
        assertEq(linkedLogic, logic);
        assertEq(linkedVault, vault);
        assertEq(linkedToken, token);
    }

    // -------------------------------------------------
    // Default detection
    // -------------------------------------------------

    function testMarksDefaultedAfterMissedPaymentsUsingMock() public {
        vm.prank(factory);
        uint256 assetId = registry.registerAsset(
            RWACommonTypes.AssetType(0),
            factory,
            1_000,
            "ipfs"
        );

        DefaultingLogicMock logic = new DefaultingLogicMock();

        vm.prank(factory);
        registry.linkContracts(
            assetId,
            address(logic),
            makeAddr("vault"),
            makeAddr("token")
        );

        vm.prank(compliance);
        registry.activateAsset(assetId);

        vm.prank(payment);
        registry.checkAndTriggerDefault(assetId);

        assertEq(uint256(getCurrentStatus(assetId)), uint256(RWACommonTypes.AssetStatus.DEFAULTED));
    }

    // -------------------------------------------------
    // Schedule sync on recordPayment
    // -------------------------------------------------

    function testRecordPaymentSyncsScheduleFromLogic() public {
        vm.prank(factory);
        uint256 assetId = registry.registerAsset(
            RWACommonTypes.AssetType(0),
            factory,
            1_000,
            "ipfs"
        );

        uint256 expectedMonthly = 1000 ether;
        MockCashFlowLogic logic = new MockCashFlowLogic(expectedMonthly);

        vm.prank(factory);
        registry.linkContracts(
            assetId,
            address(logic),
            makeAddr("vault"),
            makeAddr("token")
        );

        vm.prank(compliance);
        registry.activateAsset(assetId);

        vm.prank(payment);
        registry.recordPayment(assetId, expectedMonthly);

        (uint256 nextPaymentDueDate, uint256 expectedMonthlyPayment, uint256 expectedMaturityDate) =
            getScheduleFields(assetId);
        assertEq(expectedMonthlyPayment, expectedMonthly);
        assertEq(nextPaymentDueDate, 0);
        assertEq(expectedMaturityDate, 0);
    }
}

contract DefaultingLogicMock is ICashFlowLogic {
    RWACommonTypes.AssetStatus internal status = RWACommonTypes.AssetStatus.ACTIVE;

    function initialize(bytes calldata) external {}

    function getAssetStatus() external view returns (RWACommonTypes.AssetStatus) {
        return status;
    }

    function getCashflowHealth() external pure returns (CashflowHealth) {
        return CashflowHealth.DEFAULTED;
    }

    function getExpectedPayment(uint256) external pure returns (PaymentStatus memory payment) {
        return payment;
    }

    function getRemainingPrincipal() external pure returns (uint256) {
        return 0;
    }

    function getTotalReceived() external pure returns (uint256) {
        return 0;
    }

    function getSchedule()
        external
        pure
        returns (uint256 nextPaymentDueDate, uint256 expectedPeriodicPayment, uint256 expectedMaturityDate)
    {
        return (0, 0, 0);
    }

    function processPayment(uint256, uint256)
        external
        view
        returns (RWACommonTypes.AssetStatus newStatus)
    {
        return status;
    }

    function evaluateDefault(uint256)
        external
        returns (RWACommonTypes.AssetStatus newStatus, CashflowHealth newHealth)
    {
        status = RWACommonTypes.AssetStatus.DEFAULTED;
        return (status, CashflowHealth.DEFAULTED);
    }

    function previewDefault(uint256)
        external
        view
        returns (
            RWACommonTypes.AssetStatus newStatus,
            CashflowHealth newHealth,
            uint256 daysPastDue,
            uint256 period
        )
    {
        return (status, CashflowHealth.DEFAULTED, 0, 0);
    }

    function forceDefault() external returns (bool) {
        status = RWACommonTypes.AssetStatus.DEFAULTED;
        return true;
    }

    function markMatured(uint256) external {
        status = RWACommonTypes.AssetStatus.EXPIRED;
    }
}
