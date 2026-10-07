import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Privacy · PSX Tracker" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader title="Privacy" description="What this site stores about you, who can see it, and how to remove it." />

      <Card title="What is stored">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
          <li>
            <strong>Your account:</strong> name, email address, and a scrambled (hashed) form of your password,
            never the password itself. If you use Google, your Google account id and name.
          </li>
          <li>
            <strong>What you enter:</strong> portfolios, transactions, dividends, watchlist, alerts, custom
            screens and zakat inputs.
          </li>
          <li>
            <strong>For security:</strong> your sessions (with browser and IP address, to keep you logged in and
            to limit repeated login attempts).
          </li>
          <li>
            <strong>If you connect Telegram or email alerts:</strong> your Telegram chat id, so alerts can reach
            you.
          </li>
        </ul>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          Market data (prices, indices, company information) comes from the public PSX data portal and is the
          same for everyone.
        </p>
      </Card>

      <Card title="Who can see it">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
          <li>Other users cannot see anything of yours.</li>
          <li>
            The site&apos;s administrator runs the database and can technically access everything in it,
            including your transactions. They can see your name and email in the admin page, reset your password
            if you ask, and disable accounts.
          </li>
          <li>
            Data is stored with Turso (database) and served by Vercel (hosting). Encrypted backups are kept for
            30 days. Nothing is sold or shared with advertisers, and there are no analytics or tracking cookies:
            the only cookie keeps you logged in.
          </li>
        </ul>
      </Card>

      <Card title="Your control">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
          <li>
            Download everything at any time from your{" "}
            <Link href="/account" className="underline">Account page</Link> (CSV of transactions, or all data as
            JSON).
          </li>
          <li>
            Delete your account there too. It removes your account and all your data immediately; copies in
            backups expire within 30 days.
          </li>
          <li>Emails are not verified, so please sign up with an address you actually own.</li>
        </ul>
      </Card>

      <Card title="Not investment advice">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          This is a personal record-keeping and research tool. Market data is delayed and may be incomplete or
          wrong. Nothing here is investment, tax or religious advice; the CGT and zakat pages are calculators
          with every judgement call left to you.
        </p>
      </Card>
    </div>
  );
}
