export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <section className="rounded-3xl border bg-[color:var(--card)] p-6 shadow-[0_20px_60px_rgba(18,33,38,0.08)]">
        <p className="mono text-xs tracking-[0.24em] text-[color:var(--ink-700)]">
          CREDITWEAVE • CONFIDENTIAL UNDERWRITING
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
          Borrower data stays private. Loan terms stay enforceable.
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-[color:var(--ink-700)] md:text-base">
          CreditWeave posts only minimal underwriting outputs onchain:
          approved, max LTV, rate, expiry, and reasoning hash.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border bg-[color:var(--card)] p-5">
          <p className="mono text-xs text-[color:var(--ink-700)]">STATUS</p>
          <p className="mt-2 text-2xl font-semibold text-[color:var(--mint-500)]">APPROVED</p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">Risk Badge: Medium</p>
        </article>
        <article className="rounded-2xl border bg-[color:var(--card)] p-5">
          <p className="mono text-xs text-[color:var(--ink-700)]">MAX LTV</p>
          <p className="mt-2 text-2xl font-semibold">62.00%</p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">6200 bps</p>
        </article>
        <article className="rounded-2xl border bg-[color:var(--card)] p-5">
          <p className="mono text-xs text-[color:var(--ink-700)]">RATE</p>
          <p className="mt-2 text-2xl font-semibold">8.50%</p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">850 bps</p>
        </article>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border bg-[color:var(--card)] p-5">
          <p className="mono text-xs text-[color:var(--ink-700)]">PUBLIC TERMS</p>
          <div className="mt-3 space-y-2 text-sm">
            <p className="flex justify-between"><span>Expiry</span><span className="mono">2026-03-23</span></p>
            <p className="flex justify-between"><span>Reasoning Hash</span><span className="mono">0xb8b2...9c7f</span></p>
            <p className="flex justify-between"><span>Asset ID</span><span className="mono">#1</span></p>
          </div>
        </article>
        <article className="rounded-2xl border bg-[color:var(--card)] p-5">
          <p className="mono text-xs text-[color:var(--ink-700)]">CONFIDENTIALITY GUARANTEE</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">Income data: offchain</span>
            <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">Credit data: offchain</span>
            <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">KYC/AML: offchain</span>
            <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">AI reasoning: hashed</span>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border bg-[color:var(--card)] p-5">
        <p className="mono text-xs text-[color:var(--ink-700)]">BORROWER REQUEST</p>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Borrower Address" />
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Asset ID" />
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Requested Amount" />
          <button className="rounded-xl bg-[color:var(--ink-900)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
            Request Underwriting
          </button>
        </div>
      </section>
    </main>
  );
}
