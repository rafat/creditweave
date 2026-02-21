"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/borrower", label: "Borrower" },
  { href: "/investor", label: "Investor" },
  { href: "/admin", label: "Admin" },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="rounded-2xl border bg-[color:var(--card)] p-2">
      <ul className="flex flex-wrap gap-2">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`inline-flex rounded-xl px-4 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-[color:var(--ink-900)] text-white"
                    : "bg-white text-[color:var(--ink-900)] hover:bg-[color:var(--mint-100)]"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
