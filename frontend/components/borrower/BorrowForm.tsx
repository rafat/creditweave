import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
import {
  CONTRACTS,
  LENDING_POOL_ABI,
  NAV_ORACLE_ABI,
  RWA_ASSET_REGISTRY_ABI,
  ERC20_ABI,
} from "@/lib/contracts";
import { normalizeTxError, type TxState } from "@/lib/tx";
import type { TermsTuple } from "@/lib/underwriting";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

type Props = {
  assetIdInput: string;
  terms?: TermsTuple;
  onTxStateChange: (tx: TxState) => void;
};

const ASSET_TYPES = ["REAL_ESTATE", "INVOICE", "BOND", "COMMODITY"] as const;
const ASSET_STATUSES = [
  "REGISTERED",
  "LINKED",
  "ACTIVE",
  "UNDER_REVIEW",
  "DEFAULTED",
  "LIQUIDATING",
  "LIQUIDATED",
  "PAUSED",
  "EXPIRED",
] as const;

const toBigInt = (value: string): bigint | null => {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const safeParseUnits = (value: string, decimals: number): bigint => {
  try {
    const cleanValue = (value || "0").replace(/,/g, '');
    return parseUnits(cleanValue, decimals);
  } catch {
    return 0n;
  }
};

export default function BorrowForm({ assetIdInput, terms, onTxStateChange }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();

  const [borrowAmountInput, setBorrowAmountInput] = useState("");
  const [depositAmountInput, setDepositAmountInput] = useState("");
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const assetId = useMemo(() => toBigInt(assetIdInput), [assetIdInput]);

  const approved = terms?.[0] ?? false;
  const maxLtvBps = terms?.[1] ?? 0;
  const creditLimit = terms?.[3] ?? 0n;
  const expiry = terms?.[4] ?? 0n;
  const isExpired = expiry > 0n && expiry <= BigInt(Math.floor(Date.now() / 1000));

  // 1. Read Token Address for this Asset
  const tokenAddrRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "assetIdToToken",
    args: assetId !== null ? [assetId] : undefined,
    query: { enabled: assetId !== null },
  });
  const tokenAddress = tokenAddrRead.data as `0x${string}` | undefined;

  // 2. Read User's Wallet Balance of this Token
  const walletBalanceRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { 
      enabled: Boolean(tokenAddress && address),
      refetchInterval: 5000,
    },
  });
  const walletBalance = (walletBalanceRead.data as bigint | undefined) ?? 0n;

  // 3. Read Allowance for Lending Pool
  const allowanceRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, contracts.lendingPool] : undefined,
    query: { 
      enabled: Boolean(tokenAddress && address),
      refetchInterval: 5000,
    },
  });
  const allowance = (allowanceRead.data as bigint | undefined) ?? 0n;

  const collateralRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "collateral",
    args: address && assetId !== null ? [address, assetId] : undefined,
    query: {
      enabled: Boolean(address && assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 5000,
    },
  });

  const debtRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "debt",
    args: address && assetId !== null ? [address, assetId] : undefined,
    query: {
      enabled: Boolean(address && assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 5000,
    },
  });

  const navFreshRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "isFresh",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: Boolean(assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 5000,
    },
  });

  const navDataRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "getNAVData",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: Boolean(assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 5000,
    },
  });

  const assetCoreRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.rwaAssetRegistry,
    abi: RWA_ASSET_REGISTRY_ABI,
    functionName: "getAssetCore",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: Boolean(assetId !== null && chainId === SUPPORTED_CHAIN_ID),
    },
  });

  const collateralShares = (collateralRead.data as bigint | undefined) ?? 0n;
  const debtPrincipal = ((debtRead.data as [bigint, bigint] | undefined)?.[0] ?? 0n);
  const navIsFresh = Boolean(navFreshRead.data);
  const nav = ((navDataRead.data as [bigint, bigint, `0x${string}`] | undefined)?.[0] ?? 0n);
  const assetCore = assetCoreRead.data as
    | [bigint, number, `0x${string}`, number, bigint, bigint]
    | undefined;
  const assetType = assetCore ? ASSET_TYPES[assetCore[1]] ?? `UNKNOWN(${assetCore[1]})` : "N/A";
  const assetStatus = assetCore ? ASSET_STATUSES[assetCore[3]] ?? `UNKNOWN(${assetCore[3]})` : "N/A";
  const assetOriginator = assetCore?.[2] ?? "N/A";
  const registeredAssetValue = assetCore?.[4] ?? 0n;

  const collateralValue = (collateralShares * nav) / 10n ** 18n;
  const collateralCap = (collateralValue * BigInt(maxLtvBps)) / 10_000n;
  const maxBorrowFromTerms = (approved && creditLimit > 0n && creditLimit < collateralCap) ? creditLimit : collateralCap;
  const remainingBorrowCapacity =
    maxBorrowFromTerms > debtPrincipal ? maxBorrowFromTerms - debtPrincipal : 0n;

  const depositAmountWei = safeParseUnits(depositAmountInput, 18);
  const needsApproval = allowance < depositAmountWei && depositAmountWei > 0n;

  const handleApprove = async () => {
    try {
      if (!tokenAddress) return;
      onTxStateChange({ phase: "awaiting_signature", message: "Approving token for pool..." });
      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [contracts.lendingPool, depositAmountWei],
      });
      onTxStateChange({ phase: "submitted", hash, message: "Approval submitted..." });
    } catch (e) {
      onTxStateChange({ phase: "failed", message: normalizeTxError(e) });
    }
  };

  const handleDeposit = async () => {
    try {
      if (assetId === null) return;
      onTxStateChange({ phase: "awaiting_signature", message: "Depositing collateral..." });
      const hash = await writeContractAsync({
        address: contracts.lendingPool,
        abi: LENDING_POOL_ABI,
        functionName: "depositCollateral",
        args: [assetId, depositAmountWei],
      });
      onTxStateChange({ phase: "submitted", hash, message: "Deposit submitted..." });
      setDepositAmountInput("");
    } catch (e) {
      onTxStateChange({ phase: "failed", message: normalizeTxError(e) });
    }
  };

  const canBorrow =
    Boolean(assetId !== null) &&
    approved &&
    !isExpired &&
    navIsFresh &&
    nav > 0n &&
    remainingBorrowCapacity > 0n;

  const borrowAmountWei = safeParseUnits(borrowAmountInput, 18);

  const submitBorrow = async () => {
    try {
      if (!isConnected || !address) throw new Error("Connect wallet first.");
      if (chainId !== SUPPORTED_CHAIN_ID) throw new Error("Switch to Sepolia first.");
      if (assetId === null) throw new Error("Asset ID must be a valid integer.");
      if (!approved) throw new Error("Borrow disabled: underwriting not approved.");
      if (isExpired) throw new Error("Borrow disabled: underwriting terms expired.");
      if (!navIsFresh || nav === 0n) throw new Error("Borrow disabled: NAV is stale or unavailable.");

      if (borrowAmountWei <= 0n) throw new Error("Borrow amount must be greater than zero.");
      if (borrowAmountWei > remainingBorrowCapacity) {
        throw new Error("Borrow amount exceeds estimated remaining borrow capacity.");
      }

      onTxStateChange({
        phase: "awaiting_signature",
        message: "Confirm borrow transaction in MetaMask...",
      });

      const hash = await writeContractAsync({
        chainId: SUPPORTED_CHAIN_ID,
        address: contracts.lendingPool,
        abi: LENDING_POOL_ABI,
        functionName: "borrow",
        args: [assetId, borrowAmountWei],
      });

      onTxStateChange({
        phase: "submitted",
        hash,
        message: "Borrow transaction submitted. Waiting for confirmation...",
      });
      setBorrowAmountInput("");
    } catch (error) {
      onTxStateChange({
        phase: "failed",
        message: normalizeTxError(error),
      });
    }
  };

  const handleMaxDeposit = () => {
    setDepositAmountInput(formatUnits(walletBalance, 18));
  };

  const handleMaxBorrow = () => {
    setBorrowAmountInput(formatUnits(remainingBorrowCapacity, 18));
  };

  const formatCurrency = (value: bigint) => 
    Number(formatUnits(value, 18)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
  const formatToken = (value: bigint) => 
    Number(formatUnits(value, 18)).toLocaleString('en-US', { maximumFractionDigits: 4 });

  const totalProposedDebt = debtPrincipal + borrowAmountWei;
  const ltvUtilization = maxBorrowFromTerms > 0n ? Number((totalProposedDebt * 10000n) / maxBorrowFromTerms) / 100 : 0;
  
  let healthColor = "bg-green-500";
  if (ltvUtilization > 90) healthColor = "bg-red-500";
  else if (ltvUtilization > 75) healthColor = "bg-yellow-500";
  else if (ltvUtilization > 50) healthColor = "bg-blue-500";

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="mono text-xs text-[color:var(--ink-700)]">STEP 2: DEPOSIT COLLATERAL</p>
        <p className="mt-1 text-sm text-[color:var(--ink-700)] mb-4">
          Pledge your RWA shares to the pool to unlock your borrowing capacity.
        </p>
        
        <div className="flex flex-col gap-4">
          <div className="flex gap-3 flex-col sm:flex-row">
            <div className="relative flex-1">
              <input
                className="rounded-xl border px-3 py-2 text-sm w-full pr-16"
                value={depositAmountInput}
                onChange={(e) => setDepositAmountInput(e.target.value)}
                placeholder="Deposit Amount"
                type="number"
                min="0"
                step="any"
              />
              <button
                type="button"
                onClick={handleMaxDeposit}
                className="absolute right-2 top-1.5 rounded-lg bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
              >
                MAX
              </button>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={!needsApproval || depositAmountWei === 0n}
                className={`rounded-xl px-6 py-2 text-sm font-medium transition ${
                  needsApproval && depositAmountWei > 0n
                    ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed border"
                }`}
              >
                1. Approve
              </button>
              <button
                onClick={handleDeposit}
                disabled={needsApproval || walletBalance < depositAmountWei || depositAmountWei === 0n}
                className={`rounded-xl px-6 py-2 text-sm font-medium transition ${
                  !needsApproval && walletBalance >= depositAmountWei && depositAmountWei > 0n
                    ? "bg-black text-white hover:bg-gray-800 shadow-sm"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed border"
                }`}
              >
                2. Deposit
              </button>
            </div>
          </div>
          
          <div className="rounded-xl bg-gray-50 p-3 text-xs flex flex-col gap-1">
             <div className="flex justify-between">
               <span className="text-gray-500">Wallet Balance:</span>
               <span className="font-semibold text-gray-900">{formatToken(walletBalance)} RWA Shares</span>
             </div>
             <div className="flex justify-between border-t pt-1">
               <span className="text-gray-500">Already Pledged:</span>
               <span className="font-semibold text-blue-600">{formatToken(collateralShares)} RWA Shares</span>
             </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-[color:var(--card)] p-5 shadow-sm">
        <p className="mono text-xs text-[color:var(--ink-700)]">STEP 3: BORROW STABLECOINS</p>
        <div className="mt-4 flex gap-3 flex-col sm:flex-row">
          <div className="relative flex-1">
            <input
              className="rounded-xl border px-3 py-2 text-sm w-full pr-16"
              value={borrowAmountInput}
              onChange={(e) => setBorrowAmountInput(e.target.value)}
              placeholder="Borrow Amount"
              type="number"
              min="0"
              step="any"
            />
            <button
              type="button"
              onClick={handleMaxBorrow}
              className="absolute right-2 top-1.5 rounded-lg bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
            >
              MAX
            </button>
          </div>
          <button
            type="button"
            onClick={submitBorrow}
            disabled={!canBorrow || borrowAmountWei === 0n || borrowAmountWei > remainingBorrowCapacity}
            className="rounded-xl bg-[color:var(--ink-900)] px-8 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Borrow
          </button>
        </div>

        <div className="mt-5 space-y-1">
          <div className="flex justify-between text-xs text-gray-600">
            <span>LTV Utilization</span>
            <span className="font-medium">{ltvUtilization.toFixed(2)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-full transition-all duration-300 ${healthColor}`}
              style={{ width: `${Math.min(ltvUtilization, 100)}%` }}
            />
          </div>
        </div>

        <div className="mt-5 space-y-2 text-sm border-t pt-4">
          <div className="flex justify-between font-medium">
            <span>Borrowing Capacity (LTV {maxLtvBps / 100}%)</span>
            <span className="text-green-600">${formatCurrency(maxBorrowFromTerms)}</span>
          </div>
          <div className="flex justify-between text-gray-500 text-xs">
            <span>Estimated collateral value (NAV)</span>
            <span>${formatCurrency(collateralValue)}</span>
          </div>
          <div className="flex justify-between text-gray-500 text-xs">
             <span>Current Principal Debt</span>
             <span>${formatCurrency(debtPrincipal)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-gray-900">
            <span>Remaining to Borrow</span>
            <span>${formatCurrency(remainingBorrowCapacity)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
