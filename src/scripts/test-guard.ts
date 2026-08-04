import path from "node:path";

/**
 * Refuse to run a destructive test against the real database.
 *
 * ESM imports are hoisted, so a test module CANNOT set process.env.DB_PATH at
 * the top of its own file and expect `@/db` to see it — the db client is
 * constructed during import evaluation, before any statement in the test body
 * runs. DB_PATH must therefore be set by the npm script; this guard turns a
 * mistake into a loud failure instead of silently wiping real holdings.
 *
 * Tests drop and recreate their own tables rather than deleting the file,
 * so this stays correct no matter when the db client opened the handle.
 */
export function assertScratchDatabase(): string {
  const configured = process.env.DB_PATH;
  const real = path.join(process.cwd(), "data", "kmi30.db");

  if (!configured) {
    throw new Error(
      "DB_PATH is not set. Run this test via its npm script, which points it " +
        "at a scratch database.",
    );
  }

  if (path.resolve(configured) === path.resolve(real)) {
    throw new Error(
      `Refusing to run destructive tests against the real database (${real}).`,
    );
  }

  return configured;
}
