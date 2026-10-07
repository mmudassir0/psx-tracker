import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";
import { countUnacknowledgedEvents } from "@/lib/alerts";
import { isDatabaseEmpty, latestQuoteDate } from "@/lib/market";
import { expectedSessionDate, weekdaysBetween } from "@/lib/dates";
import { prettyDate } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PSX Tracker",
  description:
    "Pakistan Stock Exchange research: every index, a whole-market heatmap, your portfolio and alerts.",
  // Installed on an iPhone home screen it opens like an app, which iOS
  // requires before a site may send push notifications.
  appleWebApp: { capable: true, title: "PSX Tracker", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Guarded: the layout renders before the first ingest, when no tables exist.
  const empty = await isDatabaseEmpty();
  const user = await getCurrentUser();
  const unreadAlerts = empty ? 0 : await countUnacknowledgedEvents(user?.id ?? null);

  // One missing session is usually a PSX holiday; two means the daily job
  // is not landing and the numbers on screen should not be trusted.
  const lastSession = empty ? null : await latestQuoteDate();
  const missedSessions = lastSession
    ? weekdaysBetween(lastSession, expectedSessionDate())
    : 0;

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
                PSX Tracker
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Pakistan Stock Exchange
              </span>
            </Link>
            <NavLinks
              unreadAlerts={unreadAlerts}
              user={user ? { name: user.name, isAdmin: user.role === "admin" } : null}
            />
          </header>

          {lastSession && missedSessions >= 2 && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <span className="font-medium">Prices may be out of date.</span>{" "}
              The latest data is from {prettyDate(lastSession)}, about{" "}
              {missedSessions} trading sessions behind. The daily update may be
              failing; check{" "}
              <Link href="/health" className="underline">
                Health
              </Link>
              .
            </div>
          )}

          <main className="flex-1 py-6">{children}</main>

          <footer className="border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Data is scraped from the public PSX data portal (dps.psx.com.pk) and
            is delayed, not licensed real-time. This is a personal research and
            record-keeping tool — it reports market data and your own numbers,
            and is not investment advice.{" "}
            <Link href="/privacy" className="underline">
              Privacy
            </Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
