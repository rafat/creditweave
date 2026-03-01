// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/RWAAssetRegistry.sol";
import "../src/RentalCashFlowLogic.sol";
import "../src/RWARevenueVault.sol";
import "../src/InvestorShareToken.sol";
import "../src/RWALendingPool.sol";
import "../src/RWACommonTypes.sol";
import "../src/UnderwritingRegistryV2.sol";
import "../src/UnderwritingPolicyTypes.sol";
import "../src/PortfolioRiskRegistry.sol";

contract TokenizeAsset is Script {
    function run() external {
        // Retrieve addresses from environment variables passed from the backend
        address registryAddress = vm.envAddress("NEXT_PUBLIC_RWA_ASSET_REGISTRY");
        address lendingPoolAddress = vm.envAddress("NEXT_PUBLIC_LENDING_POOL");
        address underwritingV2Address = vm.envOr("UNDERWRITING_REGISTRY_V2", address(0));
        address portfolioRiskRegistryAddress = vm.envOr("PORTFOLIO_RISK_REGISTRY", address(0));

        // Input parameters from environment variables
        string memory propertyAddress = vm.envOr("PROPERTY_ADDRESS", string("Unknown Property"));
        uint256 assetValue = vm.envUint("ASSET_VALUE");
        address originator = vm.envAddress("ORIGINATOR");
        uint256 loanProductRaw = vm.envOr("LOAN_PRODUCT", uint256(1)); // Default: BRIDGE
        bytes32 segmentId = vm.envOr("SEGMENT_ID", bytes32(0)); // Optional portfolio segment
        
        require(originator != address(0), "Originator address is required");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);

        RWAAssetRegistry registry = RWAAssetRegistry(registryAddress);
        RWALendingPool lendingPool = RWALendingPool(lendingPoolAddress);

        // 1. Verify KYC and Whitelist for Originator (Requires COMPLIANCE_ROLE)
        if (!registry.kycVerified(originator)) {
            registry.verifyKYC(originator);
        }
        
        // Ensure originator is whitelisted so they can receive and transfer tokens
        registry.whitelistRecipient(originator);
        
        // Ensure the Lending Pool is authorized to receive and hold tokens as collateral
        if (!registry.kycVerified(lendingPoolAddress)) {
            registry.verifyKYC(lendingPoolAddress);
        }
        if (!registry.isWhitelisted(lendingPoolAddress)) {
            registry.whitelistRecipient(lendingPoolAddress);
        }

        // 2. Register Asset (Requires ASSET_FACTORY_ROLE)
        uint256 assetId = registry.registerAsset(
            RWACommonTypes.AssetType.REAL_ESTATE,
            originator,
            assetValue,
            propertyAddress 
        );
        console.log("Registered new Asset ID:", assetId);

        // 3. Deploy Logic
        RentalCashFlowLogic logic = new RentalCashFlowLogic();
        
        uint256 rentAmount = vm.envOr("RENT_AMOUNT", uint256(1000 ether));
        uint256 interval = 30 days;
        uint256 graceUnits = 5;
        uint256 timeUnit = 1 days;

        bytes memory initData = abi.encode(
            rentAmount,
            interval,
            block.timestamp,       // first due now
            graceUnits,
            block.timestamp + 365 days, // end date
            timeUnit,
            address(registry)
        );
        logic.initialize(initData);
        console.log("Deployed Logic at:", address(logic));

        // 4. Deploy Vault
        RWARevenueVault vault = new RWARevenueVault();
        vault.initialize(
            deployer, // admin
            deployer, // agent
            address(logic),
            address(lendingPool.stablecoin()),
            address(registry),
            assetId,
            deployer  // feeRecipient
        );
        console.log("Deployed Vault at:", address(vault));

        // 5. Deploy Token
        InvestorShareToken token = new InvestorShareToken(
            assetId,
            "CreditWeave Property Share",
            "CWRWA",
            type(uint256).max, // maxSupply
            address(registry),
            address(vault),
            deployer // admin
        );
        console.log("Deployed Token at:", address(token));

        // Set token in vault
        vault.setTokenContracts(address(token));

        // 6. Link Contracts
        registry.linkContracts(assetId, address(logic), address(vault), address(token));
        
        // 7. Activate Asset
        registry.activateAsset(assetId);

        // 8. Configure Lending Pool
        lendingPool.setAssetToken(assetId, address(token));
        lendingPool.setAssetLogic(assetId, address(logic));

        // 8.1 Configure Underwriting V2 loan product (optional but recommended)
        if (underwritingV2Address != address(0)) {
            require(loanProductRaw > 0 && loanProductRaw <= uint256(type(uint8).max), "Invalid loan product");
            UnderwritingRegistryV2(underwritingV2Address).setAssetLoanProduct(
                assetId,
                UnderwritingPolicyTypes.LoanProduct(uint8(loanProductRaw))
            );
            console.log("Configured V2 loan product:", loanProductRaw);
        }

        // 8.2 Configure Portfolio Risk segment (optional)
        if (portfolioRiskRegistryAddress != address(0) && segmentId != bytes32(0)) {
            PortfolioRiskRegistry(portfolioRiskRegistryAddress).assignAssetSegment(assetId, segmentId);
            console.log("Assigned portfolio segment for asset");
        }

        // 9. Mint shares to the originator
        // Mint amount is equal to the asset value (1 token per $1 of value)
        vault.mintShares(originator, assetValue); 
        console.log("Minted shares equal to value:", assetValue);

        vm.stopBroadcast();
        
        // Output the final asset ID cleanly so the Node script can parse it
        console.log("SUCCESS_ASSET_ID:", assetId);
    }
}
