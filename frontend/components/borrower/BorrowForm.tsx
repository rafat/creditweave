import { useMemo, useState } from "react";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
import {
  CONTRACTS,
  LENDING_POOL_ABI,
  NAV_ORACLE_ABI,
  PORTFOLIO_RISK_REGISTRY_ABI,
  UNDERWRITING_REGISTRY_V2_ABI,
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

const APPROVED_CONDITIONAL_STATUS = 1;
const WATCHLIST_STATUS = 2;
const WITHDRAW_DUST_DEBT_WEI = 10n ** 14n; // 0.0001 stable units (18 decimals), UI-only
const MAX_REPAY_BUFFER_WEI = 10n ** 16n; // 0.01 stable units; safe because onchain repay caps to debt

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
  const borrowerArg = (address ?? zeroAddress) as `0x${string}`;

  const [borrowAmountInput, setBorrowAmountInput] = useState("");
  const [depositAmountInput, setDepositAmountInput] = useState("");
  const [repayAmountInput, setRepayAmountInput] = useState("");
  const [withdrawAmountInput, setWithdrawAmountInput] = useState("");
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const assetId = useMemo(() => toBigInt(assetIdInput), [assetIdInput]);
  const assetIdArg = assetId ?? 0n;

  const approved = terms?.[0] ?? false;
  const maxLtvBps = terms?.[1] ?? 0;
  const creditLimit = terms?.[3] ?? 0n;
  const expiry = terms?.[4] ?? 0n;
  const isExpired = expiry > 0n && expiry <= BigInt(Math.floor(Date.now() / 1000));
  const underwritingV2Address = contracts.underwritingRegistryV2 ?? contracts.activeUnderwritingRegistry;

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

  // Stablecoin balance (for repayment)
  const stablecoinBalanceRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.stablecoin,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 5000 },
  });
  const stablecoinBalance = (stablecoinBalanceRead.data as bigint | undefined) ?? 0n;

  // Stablecoin allowance for pool (for repayment)
  const stablecoinAllowanceRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.stablecoin,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, contracts.lendingPool] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 5000 },
  });
  const stablecoinAllowance = (stablecoinAllowanceRead.data as bigint | undefined) ?? 0n;

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

  const totalDebtRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "getDebtWithAccrual",
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

  const v2DecisionRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: underwritingV2Address,
    abi: UNDERWRITING_REGISTRY_V2_ABI,
    functionName: "getDecision",
    args: [borrowerArg, assetIdArg],
    query: {
      enabled: Boolean(contracts.usesUnderwritingV2 && address && assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 5000,
    },
  });

  const v2EffectiveLtvRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: underwritingV2Address,
    abi: UNDERWRITING_REGISTRY_V2_ABI,
    functionName: "effectiveMaxLtvBps",
    args: [borrowerArg, assetIdArg],
    query: {
      enabled: Boolean(contracts.usesUnderwritingV2 && address && assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 5000,
    },
  });

  const poolPortfolioRiskRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "portfolioRiskRegistry",
    query: {
      enabled: Boolean(chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 10000,
    },
  });

  const portfolioRiskRegistryAddress = (
    contracts.portfolioRiskRegistry ||
    (poolPortfolioRiskRead.data as `0x${string}` | undefined)
  ) as `0x${string}` | undefined;
  const hasPortfolioRiskRegistry =
    Boolean(portfolioRiskRegistryAddress) && portfolioRiskRegistryAddress !== zeroAddress;

  const segmentIdRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: portfolioRiskRegistryAddress,
    abi: PORTFOLIO_RISK_REGISTRY_ABI,
    functionName: "getSegmentForAsset",
    args: [assetIdArg],
    query: {
      enabled: Boolean(hasPortfolioRiskRegistry && assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 10000,
    },
  });

  const segmentId = segmentIdRead.data as `0x${string}` | undefined;
  const hasAssignedSegment = Boolean(segmentId && !/^0x0+$/.test(segmentId));

  const segmentConfigRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: portfolioRiskRegistryAddress,
    abi: PORTFOLIO_RISK_REGISTRY_ABI,
    functionName: "getSegmentConfig",
    args: [(segmentId ?? `0x${"0".repeat(64)}`) as `0x${string}`],
    query: {
      enabled: Boolean(
        hasPortfolioRiskRegistry &&
          hasAssignedSegment &&
          chainId === SUPPORTED_CHAIN_ID,
      ),
      refetchInterval: 10000,
    },
  });

  const collateralShares = (collateralRead.data as bigint | undefined) ?? 0n;
  const debtPrincipal = ((debtRead.data as [bigint, bigint] | undefined)?.[0] ?? 0n);
  const totalDebt = (totalDebtRead.data as bigint | undefined) ?? 0n;
  const accruedInterest = totalDebt > debtPrincipal ? totalDebt - debtPrincipal : 0n;

  const navIsFresh = Boolean(navFreshRead.data);
  const nav = ((navDataRead.data as [bigint, bigint, `0x${string}`] | undefined)?.[0] ?? 0n);
  const decision = v2DecisionRead.data as { loanProduct?: number; status?: number; 0?: number; 1?: number } | undefined;
  const loanProduct = Number(decision?.loanProduct ?? decision?.[0] ?? 0);
  const decisionStatus = Number(decision?.status ?? decision?.[1] ?? 0);
  const effectiveMaxLtvBps = Number(v2EffectiveLtvRead.data as number | bigint | undefined) || 0;
  const ltvForCapacityBps =
    contracts.usesUnderwritingV2 && effectiveMaxLtvBps > 0
      ? effectiveMaxLtvBps
      : maxLtvBps;

  const segmentConfig = segmentConfigRead.data as { ltvHaircutBps?: number; 2?: number } | undefined;
  const segmentHaircutBps = Number(segmentConfig?.ltvHaircutBps ?? segmentConfig?.[2] ?? 0);
  const hasWatchlistOrConditionalState =
    decisionStatus === APPROVED_CONDITIONAL_STATUS || decisionStatus === WATCHLIST_STATUS;

  const baseBufferBps =
    loanProduct === 2 ? 2_000 : // STABILIZED_TERM
    loanProduct === 1 ? 3_000 : // BRIDGE
    loanProduct === 3 ? 3_500 : // CONSTRUCTION_LITE
    2_000; // default
  const riskAdjustmentBps = (segmentHaircutBps > 0 || hasWatchlistOrConditionalState) ? 1_000 : 0;
  const dynamicBufferBps = baseBufferBps + riskAdjustmentBps;
  const dynamicBufferLabel = `${(dynamicBufferBps / 100).toFixed(0)}% BUFFER`;

  const collateralValue = (collateralShares * nav) / 10n ** 18n;
  const collateralCap = (collateralValue * BigInt(ltvForCapacityBps)) / 10_000n;
  const maxBorrowFromTerms = (approved && creditLimit > 0n && creditLimit < collateralCap) ? creditLimit : collateralCap;
  const remainingBorrowCapacity =
    maxBorrowFromTerms > debtPrincipal ? maxBorrowFromTerms - debtPrincipal : 0n;
  const safeBorrowCapacity =
    (remainingBorrowCapacity * BigInt(10_000 - dynamicBufferBps)) / 10_000n;

  // Safe deposit math
  const minRequiredCollateralValue = ltvForCapacityBps > 0 ? (creditLimit * 10000n) / BigInt(ltvForCapacityBps) : 0n;
  const minRequiredSharesWei = nav > 0n ? (minRequiredCollateralValue * 10n**18n) / nav : 0n;
  const safeDepositSharesRaw =
    (minRequiredSharesWei * BigInt(10_000 + dynamicBufferBps)) / 10_000n;
  
  const ONE_SHARE = 10n**18n;
  // Round up to the nearest whole share for clean UX
  let safeDepositShares = ((safeDepositSharesRaw + ONE_SHARE - 1n) / ONE_SHARE) * ONE_SHARE;
  
  // Edge case: Cap at total available whole shares if user doesn't have enough to hit the optimal buffer
  const totalSharesOwned = walletBalance + collateralShares;
  const totalSharesWhole = (totalSharesOwned / ONE_SHARE) * ONE_SHARE;
  if (safeDepositShares > totalSharesWhole) {
    safeDepositShares = totalSharesWhole;
  }

  let targetAdditionalDeposit = safeDepositShares > collateralShares 
    ? safeDepositShares - collateralShares 
    : 0n;
    
  // Ensure the delta to deposit is also a whole number (rounded up)
  targetAdditionalDeposit = ((targetAdditionalDeposit + ONE_SHARE - 1n) / ONE_SHARE) * ONE_SHARE;
  
  // Final safety check: can't deposit more than wallet balance (using whole shares)
  const walletBalanceWhole = (walletBalance / ONE_SHARE) * ONE_SHARE;
  if (targetAdditionalDeposit > walletBalanceWhole) {
    targetAdditionalDeposit = walletBalanceWhole;
  }

  // Withdrawable / Idle math
  const effectiveDebtForWithdraw = totalDebt <= WITHDRAW_DUST_DEBT_WEI ? 0n : totalDebt;
  const minSharesToBackDebt = (effectiveDebtForWithdraw > 0n && nav > 0n && maxLtvBps > 0)
    ? (((effectiveDebtForWithdraw * 10000n) / BigInt(maxLtvBps)) * 10n**18n) / nav
    : 0n;
  // UI display rule: if debt backing requires less than 1 full share, treat as zero to avoid phantom 1-share lock.
  const minSharesToBackDebtForDisplay = minSharesToBackDebt < ONE_SHARE ? 0n : minSharesToBackDebt;
  
  const withdrawableShares = collateralShares > minSharesToBackDebtForDisplay 
    ? collateralShares - minSharesToBackDebtForDisplay 
    : 0n;
  const pledgedWholeShares = (collateralShares / ONE_SHARE) * ONE_SHARE;
  const withdrawableWholeShares = (withdrawableShares / ONE_SHARE) * ONE_SHARE;
  // Step 5 safety guard should be based on current active debt (not full approved credit limit).
  const minSharesToBackCurrentDebt = (effectiveDebtForWithdraw > 0n && nav > 0n && ltvForCapacityBps > 0)
    ? (((effectiveDebtForWithdraw * 10000n) / BigInt(ltvForCapacityBps)) * 10n**18n) / nav
    : 0n;
  const safeDebtBufferTargetSharesRaw =
    (minSharesToBackCurrentDebt * BigInt(10_000 + dynamicBufferBps)) / 10_000n;
  const safeDebtBufferTargetWholeShares =
    ((safeDebtBufferTargetSharesRaw + ONE_SHARE - 1n) / ONE_SHARE) * ONE_SHARE;
  const maxWithdrawKeepingBufferWholeSharesRaw =
    pledgedWholeShares > safeDebtBufferTargetWholeShares
      ? pledgedWholeShares - safeDebtBufferTargetWholeShares
      : 0n;
  const maxWithdrawKeepingBufferWholeShares =
    maxWithdrawKeepingBufferWholeSharesRaw > withdrawableWholeShares
      ? withdrawableWholeShares
      : maxWithdrawKeepingBufferWholeSharesRaw;
  const bufferAlreadyBelowTarget = pledgedWholeShares < safeDebtBufferTargetWholeShares;
  const lockedByDebtWholeShares =
    pledgedWholeShares > withdrawableWholeShares
      ? pledgedWholeShares - withdrawableWholeShares
      : 0n;

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

  const handleSafeDeposit = () => {
    if (targetAdditionalDeposit === 0n) return;
    const amountToSet = targetAdditionalDeposit > walletBalance ? walletBalance : targetAdditionalDeposit;
    setDepositAmountInput(formatUnits(amountToSet, 18));
  };

  const handleMaxDeposit = () => {
    const ONE_SHARE = 10n**18n;
    const walletBalanceWhole = (walletBalance / ONE_SHARE) * ONE_SHARE;
    setDepositAmountInput(formatUnits(walletBalanceWhole, 18));
  };

  const handleMaxBorrow = () => {
    setBorrowAmountInput(formatUnits(remainingBorrowCapacity, 18));
  };

  const repayAmountWei = safeParseUnits(repayAmountInput, 18);
  const needsStableApproval = stablecoinAllowance < repayAmountWei && repayAmountWei > 0n;

  const handleApproveStable = async () => {
    try {
      onTxStateChange({ phase: "awaiting_signature", message: "Approving stablecoin for pool..." });
      const hash = await writeContractAsync({
        address: contracts.stablecoin,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [contracts.lendingPool, repayAmountWei],
      });
      onTxStateChange({ phase: "submitted", hash, message: "Approval submitted..." });
    } catch (e) {
      onTxStateChange({ phase: "failed", message: normalizeTxError(e) });
    }
  };

  const handleRepay = async () => {
    try {
      if (assetId === null) return;
      onTxStateChange({ phase: "awaiting_signature", message: "Repaying loan..." });
      const hash = await writeContractAsync({
        address: contracts.lendingPool,
        abi: LENDING_POOL_ABI,
        functionName: "repay",
        args: [assetId, repayAmountWei],
      });
      onTxStateChange({ phase: "submitted", hash, message: "Repayment submitted..." });
      setRepayAmountInput("");
    } catch (e) {
      onTxStateChange({ phase: "failed", message: normalizeTxError(e) });
    }
  };

  const handleMaxRepay = () => {
    // Include small buffer to clear interest dust; onchain repay is capped to actual debt.
    const targetRepay = totalDebt + MAX_REPAY_BUFFER_WEI;
    const amountToSet = targetRepay > stablecoinBalance ? stablecoinBalance : targetRepay;
    setRepayAmountInput(formatUnits(amountToSet, 18));
  };

  const withdrawAmountWei = safeParseUnits(withdrawAmountInput, 18);

  const handleMaxWithdraw = () => {
    setWithdrawAmountInput(formatUnits(withdrawableWholeShares, 18));
  };

  const handleWithdraw = async () => {
    try {
      if (!isConnected || !address) throw new Error("Connect wallet first.");
      if (chainId !== SUPPORTED_CHAIN_ID) throw new Error("Switch to Sepolia first.");
      if (assetId === null) throw new Error("Asset ID must be a valid integer.");
      if (withdrawAmountWei <= 0n) throw new Error("Withdraw amount must be greater than zero.");
      if (withdrawAmountWei > withdrawableWholeShares) {
        throw new Error("Withdraw amount exceeds withdrawable collateral.");
      }

      onTxStateChange({ phase: "awaiting_signature", message: "Withdrawing collateral..." });
      const hash = await writeContractAsync({
        chainId: SUPPORTED_CHAIN_ID,
        address: contracts.lendingPool,
        abi: LENDING_POOL_ABI,
        functionName: "withdrawCollateral",
        args: [assetId, withdrawAmountWei],
      });
      onTxStateChange({ phase: "submitted", hash, message: "Withdraw submitted..." });
      setWithdrawAmountInput("");
    } catch (e) {
      onTxStateChange({ phase: "failed", message: normalizeTxError(e) });
    }
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
                className="rounded-xl border px-3 py-2 text-sm w-full pr-[88px]"
                value={depositAmountInput}
                onChange={(e) => setDepositAmountInput(e.target.value)}
                placeholder="Deposit Amount"
                type="number"
                min="0"
                step="any"
              />
              <div className="absolute right-2 top-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={handleSafeDeposit}
                  disabled={targetAdditionalDeposit === 0n || walletBalance === 0n || !approved}
                  className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition border border-blue-200/50"
                  title="Target full credit limit + dynamic safety buffer based on product and risk state"
                >
                  SAFE
                </button>
                <button
                  type="button"
                  onClick={handleMaxDeposit}
                  className="rounded-lg bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition"
                >
                  MAX
                </button>
              </div>
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
             <div className="flex justify-between border-t pt-1 mt-1">
               <span className="text-gray-500">Already Pledged:</span>
               <span className="font-semibold text-blue-600">{formatToken(pledgedWholeShares)} RWA Shares</span>
             </div>
             <div className="flex justify-between border-t pt-1 mt-1">
               <span className="text-gray-500 flex items-center gap-1">
                 Withdrawable / Idle
                 <span className="group relative flex items-center">
                    <span className="cursor-help rounded-full border border-gray-300 px-1.5 text-[10px] font-bold text-gray-400 hover:bg-gray-100 transition">
                      i
                    </span>
                    <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 w-48 -translate-x-1/2 rounded-lg bg-gray-800 p-2 text-center text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 z-50 shadow-xl">
                      Collateral not currently backing active debt. Withdrawing this will reduce your total borrowing capacity but won&apos;t trigger liquidation.
                      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
                    </span>
                 </span>
               </span>
               <span className="font-semibold text-gray-900">{formatToken(withdrawableWholeShares)} RWA Shares</span>
             </div>
             <div className="flex justify-between border-t pt-1 mt-1">
               <span className="text-gray-500">Locked by Active Debt:</span>
               <span className="font-semibold text-gray-900">{formatToken(lockedByDebtWholeShares)} RWA Shares</span>
             </div>
             {approved && minRequiredSharesWei > 0n && (
               <div className="flex justify-between border-t pt-1 mt-1">
                 <span className="text-gray-500 flex items-center gap-1">
                   Optimal Target 
                   <span className="rounded bg-blue-100 text-blue-700 px-1 py-0.5 text-[9px] font-bold">{dynamicBufferLabel}</span>
                 </span>
                 <span className="font-semibold text-gray-900">{formatToken(safeDepositShares)} RWA Shares</span>
               </div>
             )}
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
            <span>Borrowing Capacity (Effective LTV {ltvForCapacityBps / 100}%)</span>
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
          <div className="flex justify-between text-gray-500 text-xs">
             <span>Accrued Interest</span>
             <span className="text-red-500">+ ${formatCurrency(accruedInterest)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-gray-900">
            <span>Remaining to Borrow</span>
            <span>${formatCurrency(remainingBorrowCapacity)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-gray-900">
            <span>Total Amount Due</span>
            <span className="text-red-600">${formatCurrency(totalDebt)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 text-xs text-blue-700">
            <span>
              Suggested borrow range ({dynamicBufferLabel.replace(" BUFFER", "")} safety to no safety)
            </span>
            <span className="font-semibold">
              ${formatCurrency(safeBorrowCapacity)} - ${formatCurrency(remainingBorrowCapacity)}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="mono text-xs text-[color:var(--ink-700)]">STEP 4: REPAY LOAN</p>
        <p className="mt-1 text-sm text-[color:var(--ink-700)] mb-4">
          Repay your outstanding debt in full or part to free up collateral.
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex gap-3 flex-col sm:flex-row">
            <div className="relative flex-1">
              <input
                className="rounded-xl border px-3 py-2 text-sm w-full pr-16"
                value={repayAmountInput}
                onChange={(e) => setRepayAmountInput(e.target.value)}
                placeholder="Repay Amount"
                type="number"
                min="0"
                step="any"
              />
              <button
                type="button"
                onClick={handleMaxRepay}
                disabled={totalDebt === 0n}
                className="absolute right-2 top-1.5 rounded-lg bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
              >
                MAX
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleApproveStable}
                disabled={!needsStableApproval || repayAmountWei === 0n}
                className={`rounded-xl px-6 py-2 text-sm font-medium transition ${
                  needsStableApproval && repayAmountWei > 0n
                    ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed border"
                }`}
              >
                1. Approve
              </button>
              <button
                onClick={handleRepay}
                disabled={needsStableApproval || stablecoinBalance < repayAmountWei || repayAmountWei === 0n}
                className={`rounded-xl px-6 py-2 text-sm font-medium transition ${
                  !needsStableApproval && stablecoinBalance >= repayAmountWei && repayAmountWei > 0n
                    ? "bg-black text-white hover:bg-gray-800 shadow-sm"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed border"
                }`}
              >
                2. Repay
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 p-3 text-xs flex flex-col gap-1">
             <div className="flex justify-between">
               <span className="text-gray-500">Stablecoin Balance:</span>
               <span className="font-semibold text-gray-900">${formatCurrency(stablecoinBalance)}</span>
             </div>
             <div className="flex justify-between border-t pt-1 mt-1">
               <span className="text-gray-500">Total Accrued Debt:</span>
               <span className="font-semibold text-red-600">${formatCurrency(totalDebt)}</span>
             </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="mono text-xs text-[color:var(--ink-700)]">STEP 5: WITHDRAW COLLATERAL</p>
        <p className="mt-1 text-sm text-[color:var(--ink-700)] mb-4">
          Withdraw idle collateral shares back to your wallet.
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex gap-3 flex-col sm:flex-row">
            <div className="relative flex-1">
              <input
                className="rounded-xl border px-3 py-2 text-sm w-full pr-16"
                value={withdrawAmountInput}
                onChange={(e) => setWithdrawAmountInput(e.target.value)}
                placeholder="Withdraw Amount"
                type="number"
                min="0"
                step="any"
              />
              <button
                type="button"
                onClick={handleMaxWithdraw}
                disabled={withdrawableWholeShares === 0n}
                className="absolute right-2 top-1.5 rounded-lg bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50"
              >
                MAX
              </button>
            </div>
            <button
              onClick={handleWithdraw}
              disabled={
                withdrawAmountWei === 0n ||
                withdrawAmountWei > withdrawableWholeShares
              }
              className={`rounded-xl px-8 py-2 text-sm font-medium transition ${
                withdrawAmountWei > 0n && withdrawAmountWei <= withdrawableWholeShares
                  ? "bg-black text-white hover:bg-gray-800 shadow-sm"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed border"
              }`}
            >
              Withdraw
            </button>
          </div>

          <div className="rounded-xl bg-gray-50 p-3 text-xs flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Withdrawable / Idle:</span>
              <span className="font-semibold text-gray-900">{formatToken(withdrawableWholeShares)} RWA Shares</span>
            </div>
            <div className="flex justify-between border-t pt-1 mt-1">
              <span className="text-gray-500">Locked by Active Debt:</span>
              <span className="font-semibold text-gray-900">{formatToken(lockedByDebtWholeShares)} RWA Shares</span>
            </div>
            {approved && (safeDebtBufferTargetWholeShares > 0n || totalDebt > 0n) ? (
              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="text-gray-500">
                  Max Withdraw While Keeping safety BUFFER
                </span>
                <span className="font-semibold text-blue-700">
                  {formatToken(maxWithdrawKeepingBufferWholeShares)} RWA Shares
                </span>
              </div>
            ) : null}
            {approved && (safeDebtBufferTargetWholeShares > 0n || totalDebt > 0n) && bufferAlreadyBelowTarget ? (
              <p className="border-t pt-1 mt-1 text-amber-600">
                Current pledged collateral is below the {dynamicBufferLabel.toLowerCase()} target. Any further withdrawal
                reduces your safety margin.
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
