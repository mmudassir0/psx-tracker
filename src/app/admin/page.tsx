import { headers } from "next/headers";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { auth, requireAdmin } from "@/lib/auth";
import { Badge, Card, PageHeader, TableWrap, Th, Td } from "@/components/ui";
import { BanToggle, ResetPasswordButton, SetupTelegramButton } from "@/components/AdminControls";
import { getTelegramWebhookInfo, telegramConfigured } from "@/lib/user-notify";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const me = await requireAdmin("/admin");

  const { users, total } = await auth.api.listUsers({
    query: { limit: 500, sortBy: "createdAt", sortDirection: "desc" },
    headers: await headers(),
  });

  // How each person logs in, so a reset is only offered where it applies.
  const logins = await db
    .select({ userId: account.userId, providerId: account.providerId })
    .from(account)
    .where(inArray(account.userId, users.map((u) => u.id)))
    .all();
  const providersByUser = new Map<string, Set<string>>();
  for (const l of logins) {
    const set = providersByUser.get(l.userId) ?? new Set<string>();
    set.add(l.providerId);
    providersByUser.set(l.userId, set);
  }

  const telegram = telegramConfigured() ? await getTelegramWebhookInfo() : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Admin"
        description={`${total} account${total === 1 ? "" : "s"}. Emails are not verified, so treat them as usernames.`}
      />

      <Card
        title="Users"
        subtitle="Reset a forgotten password to a temporary one, or disable an account so it can no longer log in."
      >
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Logs in with</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const providers = providersByUser.get(u.id) ?? new Set<string>();
                const hasPassword = providers.has("credential");
                const isMe = u.id === me.id;
                return (
                  <tr key={u.id} className="align-top">
                    <Td>
                      <span className="font-medium">{u.name}</span>
                      {u.role === "admin" && (
                        <span className="ml-1.5">
                          <Badge tone="neutral">admin</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="text-slate-600 dark:text-slate-400">{u.email}</Td>
                    <Td className="text-slate-600 dark:text-slate-400">
                      {[hasPassword && "Password", providers.has("google") && "Google"]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-500">
                      {relativeTime(u.createdAt)}
                    </Td>
                    <Td>
                      {u.banned ? (
                        <Badge tone="critical">disabled</Badge>
                      ) : (
                        <Badge tone="good">active</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-start gap-2">
                        {hasPassword && !isMe && (
                          <ResetPasswordButton userId={u.id} email={u.email} />
                        )}
                        {!isMe && <BanToggle userId={u.id} banned={Boolean(u.banned)} />}
                        {isMe && <span className="text-xs text-slate-500">you</span>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      {telegramConfigured() && (
        <Card
          title="Telegram bot"
          subtitle="Tells Telegram where to deliver messages sent to the bot. Run once after deploying, and again if the site address changes."
        >
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
            {telegram === null
              ? "Couldn't read the bot's status from Telegram."
              : telegram.url
                ? <>Currently delivering to <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{telegram.url}</code>.</>
                : "Not set up yet."}
            {telegram?.lastError && (
              <span className="block text-rose-600 dark:text-rose-400">Last delivery error: {telegram.lastError}</span>
            )}
          </p>
          <SetupTelegramButton />
        </Card>
      )}
    </div>
  );
}
