import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";
import { countUnacknowledgedEvents } from "@/lib/alerts";
import { isDatabaseEmpty } from "@/lib/market";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KMI30 Tracker",
  description:
    "Personal dashboard for PSX KMI30 constituents, portfolio and Shariah recomposition tracking.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Guarded: the layout renders before the first ingest, when no tables exist.
  const unreadAlerts = isDatabaseEmpty() ? 0 : countUnacknowledgedEvents();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-4 pb-12 sm:px-6">
          <header className="flex flex-col gap-4 border-b border-slate-200 py-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">
                KMI30 Tracker
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Pakistan Stock Exchange
              </span>
            </Link>
            <NavLinks unreadAlerts={unreadAlerts} />
          </header>

          <main className="flex-1 py-6">{children}</main>

          <footer className="border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Data is scraped from the public PSX data portal (dps.psx.com.pk) and
            is delayed, not licensed real-time. This is a personal research and
            record-keeping tool — it reports market data and your own numbers,
            and is not investment advice.
          </footer>
        </div>
      </body>
    </html>
  );
}
