"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/indices", label: "Indices" },
  { href: "/screener", label: "Screener" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/strategy", label: "Strategy" },
  { href: "/zakat", label: "Zakat" },
  { href: "/recomposition", label: "Recomposition" },
  { href: "/calendar", label: "Calendar" },
  { href: "/alerts", label: "Alerts" },
  { href: "/health", label: "Health" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {LINKS.map((link) => {
        // "/indices" also owns the per-index "/index/{code}" pages.
        const active =
          link.href === "/"
            ? pathname === "/"
            : link.href === "/indices"
              ? pathname.startsWith("/indices") || pathname.startsWith("/index/")
              : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              active
                ? "rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                : "rounded-md px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
