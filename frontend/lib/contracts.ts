import type { Address } from "viem";
import { 
  DEPLOYMENTS, 
  UNDERWRITINGREGISTRY_ABI as GENERATED_UNDERWRITING_REGISTRY_ABI,
  UNDERWRITINGREGISTRYV2_ABI as GENERATED_UNDERWRITING_REGISTRY_V2_ABI,
  NAVORACLE_ABI as GENERATED_NAV_ORACLE_ABI,
  RWALENDINGPOOL_ABI as GENERATED_LENDING_POOL_ABI,
  PORTFOLIORISKREGISTRY_ABI as GENERATED_PORTFOLIO_RISK_REGISTRY_ABI,
  RWAASSETREGISTRY_ABI as GENERATED_RWA_ASSET_REGISTRY_ABI,
  MOCKERC20_ABI as GENERATED_ERC20_ABI
} from "./abis";

type ContractsByChain = {
  underwritingRegistry: Address;
  underwritingRegistryV2?: Address;
  activeUnderwritingRegistry: Address;
  usesUnderwritingV2: boolean;
  portfolioRiskRegistry?: Address;
  navOracle: Address;
  lendingPool: Address;
  rwaAssetRegistry: Address;
  stablecoin: Address;
};

const DEPLOYMENTS_ANY = DEPLOYMENTS as Record<string, Address | number | undefined>;

// Use the generated deployments as the source of truth
export const CONTRACTS: Record<number, ContractsByChain> = {
  11155111: {
    underwritingRegistry: (process.env.NEXT_PUBLIC_UNDERWRITING_REGISTRY as Address) || DEPLOYMENTS.underwritingRegistry,
    underwritingRegistryV2:
      (process.env.NEXT_PUBLIC_UNDERWRITING_REGISTRY_V2 as Address | undefined) ||
      (DEPLOYMENTS_ANY.underwritingRegistryV2 as Address | undefined),
    activeUnderwritingRegistry:
      (process.env.NEXT_PUBLIC_UNDERWRITING_REGISTRY_V2 as Address | undefined) ||
      (DEPLOYMENTS_ANY.underwritingRegistryV2 as Address | undefined) ||
      ((process.env.NEXT_PUBLIC_UNDERWRITING_REGISTRY as Address) || DEPLOYMENTS.underwritingRegistry),
    usesUnderwritingV2: Boolean(
      (process.env.NEXT_PUBLIC_UNDERWRITING_REGISTRY_V2 as Address | undefined) ||
      (DEPLOYMENTS_ANY.underwritingRegistryV2 as Address | undefined)
    ),
    portfolioRiskRegistry:
      (process.env.NEXT_PUBLIC_PORTFOLIO_RISK_REGISTRY as Address | undefined) ||
      (DEPLOYMENTS_ANY.portfolioRiskRegistry as Address | undefined),
    navOracle: (process.env.NEXT_PUBLIC_NAV_ORACLE as Address) || DEPLOYMENTS.navOracle,
    lendingPool: (process.env.NEXT_PUBLIC_LENDING_POOL as Address) || DEPLOYMENTS.lendingPool,
    rwaAssetRegistry: (process.env.NEXT_PUBLIC_RWA_ASSET_REGISTRY as Address) || DEPLOYMENTS.rwaAssetRegistry,
    stablecoin: (process.env.NEXT_PUBLIC_STABLECOIN as Address) || DEPLOYMENTS.stablecoin,
  },
};

export const UNDERWRITING_REGISTRY_ABI = GENERATED_UNDERWRITING_REGISTRY_ABI;
export const UNDERWRITING_REGISTRY_V2_ABI = GENERATED_UNDERWRITING_REGISTRY_V2_ABI;
export const LENDING_POOL_ABI = GENERATED_LENDING_POOL_ABI;
export const PORTFOLIO_RISK_REGISTRY_ABI = GENERATED_PORTFOLIO_RISK_REGISTRY_ABI;
export const ERC20_ABI = GENERATED_ERC20_ABI;
export const RWA_ASSET_REGISTRY_ABI = GENERATED_RWA_ASSET_REGISTRY_ABI;
export const NAV_ORACLE_ABI = GENERATED_NAV_ORACLE_ABI;
