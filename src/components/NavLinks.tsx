"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Grouped navigation.
 *
 * Fifteen flat links wrapped onto two rows and buried the pages that matter.
 * The destinations reached most often stay top level; the rest live under the
 * group they belong to.
 *
 * `owns` lists extra path prefixes a group covers, so a group still highlights
 * on a detail route (/index/OGDC, /sector/0807) that has no menu entry.
 */

interface NavItem {
  href: string;
  label: string;
  hint?: string;
  owns?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Market",
    items: [
      {
        href: "/indices",
        label: "Indices",
        hint: "All 17 PSX indices",
        owns: ["/index/"],
      },
      {
        href: "/sectors",
        label: "Sectors",
        hint: "Sector rollups",
        owns: ["/sector/"],
      },
      {
        href: "/screens",
        label: "Screens",
        hint: "Saved screens, run daily",
      },
      {
        href: "/movers",
        label: "Movers & breadth",
        hint: "Gainers, losers, most active",
      },
      {
        href: "/screener",
        label: "Screener",
        hint: "Sort and filter constituents",
      },
      {
        href: "/liquidity",
        label: "Liquidity",
        hint: "Traded value and exit sizing",
      },
      {
        href: "/calendar",
        label: "Calendar",
        hint: "Dividends, results, meetings",
      },
      {
        href: "/recomposition",
        label: "Recomposition",
        hint: "Index membership changes",
      },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { href: "/portfolio", label: "Holdings", hint: "Positions and P&L" },
      { href: "/risk", label: "Risk", hint: "Correlation, beta, concentration" },
      { href: "/strategy", label: "Strategy", hint: "Backtest and rebalance" },
      { href: "/watchlist", label: "Watchlist", hint: "Names you don't own yet" },
      {
        href: "/cgt",
        label: "Capital gains",
        hint: "Realised gains by tax year",
      },
      { href: "/zakat", label: "Zakat", hint: "Zakat on your holdings" },
    ],
  },
];

export function NavLinks({ unreadAlerts = 0 }: { unreadAlerts?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Close on route change, so a menu never lingers over the new page.
  useEffect(() => setOpen(null), [pathname]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!navRef.current?.contains(event.target as Node)) setOpen(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(null);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const isActive = (item: NavItem) =>
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`) ||
    (item.owns ?? []).some((prefix) => pathname.startsWith(prefix));

  return (
    <nav ref={navRef} className="flex flex-wrap items-center gap-1 text-sm">
      <Link href="/" className={linkClass(pathname === "/")}>
        Dashboard
      </Link>

      {GROUPS.map((group) => {
        const expanded = open === group.label;
        const active = group.items.some(isActive);

        return (
          <div key={group.label} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : group.label)}
              className={`${linkClass(active)} inline-flex items-center gap-1`}
            >
              {group.label}
              <span
                aria-hidden
                className={`text-[10px] transition-transform ${expanded ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>

            {expanded && (
              <div
                role="menu"
                aria-label={group.label}
                className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
              >
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    className={`flex flex-col rounded-md px-2 py-1.5 ${
                      isActive(item)
                        ? "bg-slate-100 dark:bg-slate-700"
                        : "hover:bg-slate-100 dark:hover:bg-slate-700"
                    }`}
                  >
                    <span className="font-medium">{item.label}</span>
                    {item.hint && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {item.hint}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <Link
        href="/alerts"
        className={`${linkClass(pathname.startsWith("/alerts"))} inline-flex items-center gap-1.5`}
      >
        Alerts
        {unreadAlerts > 0 && (
          <span
            className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-semibold text-white"
            aria-label={`${unreadAlerts} unread`}
          >
            {unreadAlerts > 99 ? "99+" : unreadAlerts}
          </span>
        )}
      </Link>

      <Link
        href="/health"
        className={`${linkClass(pathname.startsWith("/health"))} opacity-70`}
        title="Data health"
      >
        Health
      </Link>
    </nav>
  );
}

function linkClass(active: boolean): string {
  return active
    ? "rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
    : "rounded-md px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100";
}
