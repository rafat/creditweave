// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import "../src/UnderwritingRegistry.sol";
import "../src/UnderwritingRegistryV2.sol";
import "../src/NAVOracle.sol";
import "../src/RWALendingPool.sol";
import "../src/PortfolioRiskRegistry.sol";
import "../src/LossWaterfall.sol";

contract DeployCreditWeave is Script {

    struct Deployment {
        address underwriting;
        address underwritingV2;
        address navOracle;
        address lendingPool;
        address portfolioRiskRegistry;
        address lossWaterfall;
    }

    function run(address stable)
        external
        returns (Deployment memory d)
    {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address forwarder = vm.envAddress("SEPOLIA_FORWARDER");


        vm.startBroadcast(deployerKey);

        UnderwritingRegistry underwriting =
            new UnderwritingRegistry(forwarder);

        UnderwritingRegistryV2 underwritingV2 =
            new UnderwritingRegistryV2(forwarder);

        NAVOracle navOracle =
            new NAVOracle(forwarder);

        PortfolioRiskRegistry portfolioRisk =
            new PortfolioRiskRegistry(deployer);

        LossWaterfall waterfall =
            new LossWaterfall(deployer);

        RWALendingPool pool =
            new RWALendingPool(
                stable,
                address(underwriting),
                address(navOracle)
            );

        pool.setUnderwritingRegistryV2(address(underwritingV2));
        pool.setPortfolioRiskRegistry(address(portfolioRisk));
        pool.setLossWaterfall(address(waterfall));

        // Pool must own the waterfall so liquidation bad-debt absorption can execute.
        waterfall.transferOwnership(address(pool));

        vm.stopBroadcast();

        d = Deployment(
            address(underwriting),
            address(underwritingV2),
            address(navOracle),
            address(pool),
            address(portfolioRisk),
            address(waterfall)
        );
    }
}
