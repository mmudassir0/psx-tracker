"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth, getCurrentUser } from "@/lib/auth";

export interface AdminActionState {
  ok: boolean;
  message: string;
  /** Shown once to the admin, never stored anywhere readable. */
  tempPassword?: string;
}

/** The admin plugin checks the role too; this gives a clearer message first. */
async function adminOrError(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.role === "admin" ? null : "Only an admin can do this.";
}

/** Readable but unguessable: 16 characters from a 32-symbol alphabet. */
function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789AB";
  return [...randomBytes(16)].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function resetPasswordAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const denied = await adminOrError();
  if (denied) return { ok: false, message: denied };

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { ok: false, message: "No user selected." };

  const tempPassword = temporaryPassword();
  const requestHeaders = await headers();
  await auth.api.setUserPassword({
    body: { userId, newPassword: tempPassword },
    headers: requestHeaders,
  });
  // Log the user out everywhere, so only the new password works from now on.
  await auth.api.revokeUserSessions({ body: { userId }, headers: requestHeaders });

  return {
    ok: true,
    message: "Password reset. Give them this temporary password; they should change it on their Account page.",
    tempPassword,
  };
}

export async function setBannedAction(formData: FormData) {
  if (await adminOrError()) throw new Error("Only an admin can do this.");
  const me = await getCurrentUser();
  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === me?.id) return; // never lock yourself out

  const requestHeaders = await headers();
  if (formData.get("banned") === "true") {
    await auth.api.banUser({
      body: { userId, banReason: "Disabled by admin" },
      headers: requestHeaders,
    });
  } else {
    await auth.api.unbanUser({ body: { userId }, headers: requestHeaders });
  }
  revalidatePath("/admin");
}
