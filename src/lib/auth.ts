import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";

/**
 * Accounts: email + password, optional Google, open sign-up. Every user sees
 * only their own portfolio, watchlist, alerts, custom screens and settings;
 * market data is shared and public.
 *
 * Secret: AUTH_SECRET (or BETTER_AUTH_SECRET). Base URL: BETTER_AUTH_URL if
 * set, else the production domain Vercel provides, else inferred per request
 * (local development).
 */

const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : undefined;

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? vercelProduction,
  trustedOrigins: [
    ...(vercelProduction ? [vercelProduction] : []),
    // Preview deployments get their own URL per build.
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
  ],
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      rateLimit: schema.rateLimit,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    // There is no email service, so addresses are never verified. Treat them
    // as usernames, which is why accounts are never linked by email below.
    requireEmailVerification: false,
  },
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},
  account: {
    accountLinking: {
      // Never merge a Google login into an existing email account at
      // sign-in: emails are unverified, so anyone could register yours first
      // and take it over.
      enabled: true,
      disableImplicitLinking: true,
      // Linking is only explicit (Account page, while logged in), and only
      // for a Google account with the same, Google-verified email.
      allowDifferentEmails: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "rateLimit",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 60, max: 5 },
      "/change-password": { window: 60, max: 5 },
    },
  },
  telemetry: { enabled: false },
  // nextCookies must stay last: it lets server actions set auth cookies.
  plugins: [admin(), nextCookies()],
});

export type SessionUser = typeof auth.$Infer.Session.user;

/** The logged-in user for this request, or null. Memoised per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
});

export async function getCurrentUserId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}

/** For personal pages: send logged-out visitors to the login page. */
export async function requireUser(path: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  return user;
}

export async function requireAdmin(path: string): Promise<SessionUser> {
  const user = await requireUser(path);
  if (user.role !== "admin") redirect("/");
  return user;
}

export function googleLoginEnabled(): boolean {
  return googleConfigured;
}

/** Only same-site paths may be used as a post-login destination. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/portfolio";
  }
  return next;
}
