"use client";

import NetworkGuard from "@/components/NetworkGuard";
import AppNav from "@/components/AppNav";
import WalletBar from "@/components/WalletBar";
import SystemHealth from "@/components/admin/SystemHealth";

export default function AdminDashboard() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <AppNav />
      <WalletBar />

      <section className="rounded-3xl border bg-[color:var(--card)] p-6 shadow-[0_20px_60px_rgba(18,33,38,0.08)]">
        <p className="mono text-xs tracking-[0.24em] text-[color:var(--ink-700)]">
          CREDITWEAVE • ADMIN OPS
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
          Live protocol health and workflow signals for demos.
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-[color:var(--ink-700)] md:text-base">
          This panel tracks network readiness, private API availability, and recent underwriting activity to support
          stable live demos.
        </p>
      </section>

      <NetworkGuard>
        <SystemHealth />
      </NetworkGuard>
    </main>
  );
}
