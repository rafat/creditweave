"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { CONTRACTS, LENDING_POOL_ABI, NAV_ORACLE_ABI, RWA_ASSET_REGISTRY_ABI } from "@/lib/contracts";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";
import { normalizeTxError } from "@/lib/tx";

export default function ProtocolControls() {
  const { address } = useAccount();
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const { writeContractAsync } = useWriteContract();

  // Settings State
  const [liquidationBonus, setLiquidationBonus] = useState("");
  const [liquidationFee, setLiquidationFee] = useState("");
  const [treasuryAddress, setTreasuryAddress] = useState("");
  const [maxStaleness, setMaxStaleness] = useState("");
  const [kycAddress, setKycAddress] = useState("");
  const [whitelistAddress, setWhitelistAddress] = useState("");
  const [pauseAssetId, setPauseAssetId] = useState("");

  // --- Read Current Values ---
  const bonusRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "liquidationBonusBps",
  });

  const feeRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "protocolLiquidationFeeBps",
  });

  const treasuryRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "treasury",
  });

  const stalenessRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "maxStaleness",
  });

  const isOwnerRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "owner",
  });

  const globalPausedRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.rwaAssetRegistry,
    abi: RWA_ASSET_REGISTRY_ABI,
    functionName: "paused",
  });

  const isOwner = isOwnerRead.data === address;

  const handleUpdateBonus = async () => {
    try {
      const val = BigInt(liquidationBonus);
      await writeContractAsync({
        address: contracts.lendingPool,
        abi: LENDING_POOL_ABI,
        functionName: "setLiquidationBonus",
        args: [val],
      });
      setLiquidationBonus("");
    } catch (e) {
      alert(normalizeTxError(e));
    }
  };

  const handleUpdateFee = async () => {
    try {
      const val = BigInt(liquidationFee);
      await writeContractAsync({
        address: contracts.lendingPool,
        abi: LENDING_POOL_ABI,
        functionName: "setProtocolLiquidationFee",
        args: [val],
      });
      setLiquidationFee("");
    } catch (e) {
      alert(normalizeTxError(e));
    }
  };

  const handleUpdateTreasury = async () => {
    if (!isAddress(treasuryAddress)) return alert("Invalid address");
    try {
      await writeContractAsync({
        address: contracts.lendingPool,
        abi: LENDING_POOL_ABI,
        functionName: "setTreasury",
        args: [treasuryAddress],
      });
      setTreasuryAddress("");
    } catch (e) {
      alert(normalizeTxError(e));
    }
  };

  const handleUpdateStaleness = async () => {
    try {
      const val = BigInt(maxStaleness);
      await writeContractAsync({
        address: contracts.navOracle,
        abi: NAV_ORACLE_ABI,
        functionName: "setMaxStaleness",
        args: [val],
      });
      setMaxStaleness("");
    } catch (e) {
      alert(normalizeTxError(e));
    }
  };

  const handleVerifyKYC = async () => {
    if (!isAddress(kycAddress)) return alert("Invalid address");
    try {
      await writeContractAsync({
        address: contracts.rwaAssetRegistry,
        abi: RWA_ASSET_REGISTRY_ABI,
        functionName: "verifyKYC",
        args: [kycAddress],
      });
      setKycAddress("");
    } catch (e) {
      alert(normalizeTxError(e));
    }
  };

  const handleWhitelist = async () => {
    if (!isAddress(whitelistAddress)) return alert("Invalid address");
    try {
      await writeContractAsync({
        address: contracts.rwaAssetRegistry,
        abi: RWA_ASSET_REGISTRY_ABI,
        functionName: "whitelistRecipient",
        args: [whitelistAddress],
      });
      setWhitelistAddress("");
    } catch (e) {
      alert(normalizeTxError(e));
    }
  };

  const handlePauseAsset = async (pause: boolean) => {
    try {
      const id = BigInt(pauseAssetId);
      await writeContractAsync({
        address: contracts.rwaAssetRegistry,
        abi: RWA_ASSET_REGISTRY_ABI,
        functionName: pause ? "pauseAsset" : "unpauseAsset",
        args: [id],
      });
      setPauseAssetId("");
    } catch (e) {
      alert(normalizeTxError(e));
    }
  };

  const handleGlobalPause = async (pause: boolean) => {
    try {
      await writeContractAsync({
        address: contracts.rwaAssetRegistry,
        abi: RWA_ASSET_REGISTRY_ABI,
        functionName: pause ? "pause" : "unpause",
      });
    } catch (e) {
      alert(normalizeTxError(e));
    }
  };

  return (
    <div className="grid gap-6 pb-20">
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
           <p className="mono text-xs text-[color:var(--ink-700)]">PROTOCOL SETTINGS</p>
           <div className="flex items-center gap-2">
             <span className={`h-2 w-2 rounded-full ${globalPausedRead.data ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
             <span className="text-[10px] mono font-bold uppercase text-gray-500">
               Protocol {globalPausedRead.data ? 'Paused' : 'Active'}
             </span>
             <button 
               onClick={() => handleGlobalPause(!globalPausedRead.data)}
               className={`ml-2 rounded-lg px-3 py-1 text-[10px] font-bold uppercase transition ${
                 globalPausedRead.data 
                   ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                   : 'bg-red-100 text-red-700 hover:bg-red-200'
               }`}
             >
               {globalPausedRead.data ? 'Unpause All' : 'Emergency Pause'}
             </button>
           </div>
        </div>

        {!isOwner && (
          <p className="mt-4 text-xs text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100">
            Warning: Your wallet is not the owner/admin of all contracts. Some operations will fail.
          </p>
        )}

        <div className="mt-5 space-y-6">
          {/* Liquidation Bonus */}
          <div className="grid gap-4 md:grid-cols-2 items-end">
            <div>
              <p className="text-sm font-medium text-gray-700">Liquidation Bonus (bps)</p>
              <p className="text-xs text-gray-500 text-pretty">Current: {bonusRead.data?.toString() || "..."} (e.g. 10500 = 105% / 5% bonus)</p>
              <input
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="New Bonus (>= 10000)"
                type="number"
                value={liquidationBonus}
                onChange={(e) => setLiquidationBonus(e.target.value)}
              />
            </div>
            <button
              onClick={handleUpdateBonus}
              className="rounded-xl bg-black px-6 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
              disabled={!liquidationBonus}
            >
              Update Bonus
            </button>
          </div>

          {/* Liquidation Fee */}
          <div className="grid gap-4 md:grid-cols-2 items-end">
            <div>
              <p className="text-sm font-medium text-gray-700">Protocol Liquidation Fee (bps)</p>
              <p className="text-xs text-gray-500 text-pretty">Current: {feeRead.data?.toString() || "..."} (max 2000)</p>
              <input
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="New Fee (0-2000)"
                type="number"
                value={liquidationFee}
                onChange={(e) => setLiquidationFee(e.target.value)}
              />
            </div>
            <button
              onClick={handleUpdateFee}
              className="rounded-xl bg-black px-6 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
              disabled={!liquidationFee}
            >
              Update Fee
            </button>
          </div>

          {/* Treasury */}
          <div className="grid gap-4 md:grid-cols-2 items-end border-t pt-6">
            <div>
              <p className="text-sm font-medium text-gray-700">Protocol Treasury</p>
              <p className="text-xs text-gray-500 truncate">Current: {treasuryRead.data?.toString() || "..."}</p>
              <input
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="New Treasury Address"
                value={treasuryAddress}
                onChange={(e) => setTreasuryAddress(e.target.value)}
              />
            </div>
            <button
              onClick={handleUpdateTreasury}
              className="rounded-xl bg-black px-6 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
              disabled={!treasuryAddress}
            >
              Set Treasury
            </button>
          </div>

          {/* NAV Staleness */}
          <div className="grid gap-4 md:grid-cols-2 items-end border-t pt-6">
            <div>
              <p className="text-sm font-medium text-gray-700">NAV Max Staleness (seconds)</p>
              <p className="text-xs text-gray-500 Current text-pretty">Current: {stalenessRead.data?.toString() || "..."}</p>
              <input
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="New Window (e.g. 86400)"
                type="number"
                value={maxStaleness}
                onChange={(e) => setMaxStaleness(e.target.value)}
              />
            </div>
            <button
              onClick={handleUpdateStaleness}
              className="rounded-xl bg-black px-6 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
              disabled={!maxStaleness}
            >
              Update Staleness
            </button>
          </div>

          {/* Compliance */}
          <div className="grid gap-6 border-t pt-6">
            <p className="mono text-[10px] font-bold text-gray-400 uppercase tracking-widest">Compliance & Whitelisting</p>
            
            <div className="grid gap-4 md:grid-cols-2 items-end">
              <div>
                <p className="text-sm font-medium text-gray-700">Verify KYC</p>
                <input
                  className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="Address to Verify"
                  value={kycAddress}
                  onChange={(e) => setKycAddress(e.target.value)}
                />
              </div>
              <button
                onClick={handleVerifyKYC}
                className="rounded-xl bg-[color:var(--mint-500)] px-6 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                disabled={!kycAddress}
              >
                Grant KYC
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 items-end">
              <div>
                <p className="text-sm font-medium text-gray-700">Whitelist Recipient</p>
                <p className="text-xs text-gray-500 text-pretty">Allows address to receive RWA tokens.</p>
                <input
                  className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="Address to Whitelist"
                  value={whitelistAddress}
                  onChange={(e) => setWhitelistAddress(e.target.value)}
                />
              </div>
              <button
                onClick={handleWhitelist}
                className="rounded-xl bg-[color:var(--mint-500)] px-6 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                disabled={!whitelistAddress}
              >
                Whitelist
              </button>
            </div>
          </div>

          {/* Asset Management */}
          <div className="grid gap-6 border-t pt-6">
            <p className="mono text-[10px] font-bold text-gray-400 uppercase tracking-widest">Emergency Asset Controls</p>
            <div className="grid gap-4 md:grid-cols-3 items-end">
              <div className="md:col-span-1">
                <p className="text-sm font-medium text-gray-700">Asset ID</p>
                <input
                  className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="e.g. 1"
                  type="number"
                  value={pauseAssetId}
                  onChange={(e) => setPauseAssetId(e.target.value)}
                />
              </div>
              <button
                onClick={() => handlePauseAsset(true)}
                className="rounded-xl bg-red-600 px-6 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                disabled={!pauseAssetId}
              >
                Pause Asset
              </button>
              <button
                onClick={() => handlePauseAsset(false)}
                className="rounded-xl border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                disabled={!pauseAssetId}
              >
                Unpause Asset
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
