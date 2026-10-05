"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side auth calls go through /api/auth, where rate limits apply. */
export const authClient = createAuthClient();
