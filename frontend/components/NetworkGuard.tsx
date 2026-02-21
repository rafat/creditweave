"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

export default function NetworkGuard({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) return <>{children}</>;

  if (chainId !== SUPPORTED_CHAIN_ID) {
    return (
      <div className="rounded-2xl border bg-[#fff6ef] p-5">
        <p className="mono text-xs text-[#8c2d25]">WRONG NETWORK</p>
        <p className="mt-2 text-sm text-[#8c2d25]">
          Connect to Sepolia (chain id 11155111) to use underwriting actions.
        </p>
        <button
          type="button"
          onClick={() => switchChain({ chainId: SUPPORTED_CHAIN_ID })}
          disabled={isPending}
          className="mt-3 rounded-xl border bg-white px-3 py-2 text-sm font-medium transition hover:bg-[#ffe8d9] disabled:opacity-60"
        >
          {isPending ? "Switching..." : "Switch Network"}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
