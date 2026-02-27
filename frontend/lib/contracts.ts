import type { Address } from "viem";
import { 
  DEPLOYMENTS, 
  UNDERWRITINGREGISTRY_ABI as GENERATED_UNDERWRITING_REGISTRY_ABI,
  NAVORACLE_ABI as GENERATED_NAV_ORACLE_ABI,
  RWALENDINGPOOL_ABI as GENERATED_LENDING_POOL_ABI,
  RWAASSETREGISTRY_ABI as GENERATED_RWA_ASSET_REGISTRY_ABI,
  MOCKERC20_ABI as GENERATED_ERC20_ABI
} from "./abis";

type ContractsByChain = {
  underwritingRegistry: Address;
  navOracle: Address;
  lendingPool: Address;
  rwaAssetRegistry: Address;
};

// Use the generated deployments as the source of truth
export const CONTRACTS: Record<number, ContractsByChain> = {
  11155111: {
    underwritingRegistry: (process.env.NEXT_PUBLIC_UNDERWRITING_REGISTRY as Address) || DEPLOYMENTS.underwritingRegistry,
    navOracle: (process.env.NEXT_PUBLIC_NAV_ORACLE as Address) || DEPLOYMENTS.navOracle,
    lendingPool: (process.env.NEXT_PUBLIC_LENDING_POOL as Address) || DEPLOYMENTS.lendingPool,
    rwaAssetRegistry: (process.env.NEXT_PUBLIC_RWA_ASSET_REGISTRY as Address) || DEPLOYMENTS.rwaAssetRegistry,
  },
};

export const UNDERWRITING_REGISTRY_ABI = GENERATED_UNDERWRITING_REGISTRY_ABI;
export const LENDING_POOL_ABI = GENERATED_LENDING_POOL_ABI;
export const ERC20_ABI = GENERATED_ERC20_ABI;
export const RWA_ASSET_REGISTRY_ABI = GENERATED_RWA_ASSET_REGISTRY_ABI;
export const NAV_ORACLE_ABI = GENERATED_NAV_ORACLE_ABI;

