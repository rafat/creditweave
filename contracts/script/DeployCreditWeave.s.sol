// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import "../src/UnderwritingRegistry.sol";
import "../src/NAVOracle.sol";
import "../src/RWALendingPool.sol";

contract DeployCreditWeave is Script {

    struct Deployment {
        address underwriting;
        address navOracle;
        address lendingPool;
    }

    function run(address stable)
        external
        returns (Deployment memory d)
    {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        address forwarder = vm.envAddress("SEPOLIA_FORWARDER");


        vm.startBroadcast(deployerKey);

        UnderwritingRegistry underwriting =
            new UnderwritingRegistry(forwarder);

        NAVOracle navOracle =
            new NAVOracle(forwarder);

        RWALendingPool pool =
            new RWALendingPool(
                stable,
                address(underwriting),
                address(navOracle)
            );

        vm.stopBroadcast();

        d = Deployment(
            address(underwriting),
            address(navOracle),
            address(pool)
        );
    }
}
