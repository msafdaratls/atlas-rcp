const RELOAD_GUARD_KEY = "atlas:stale-deploy-reload-at";
const RELOAD_GUARD_WINDOW_MS = 10_000;

/**
 * Next.js Server Actions embed a build-specific action ID in the client bundle.
 * A tab left open across a deploy calls an action ID the new server no longer
 * knows, throwing this exact message instead of running the action.
 */
export function isStaleServerActionError(error: Error): boolean {
  return /Failed to find Server Action/i.test(error.message);
}

/**
 * Reloads once to pick up the current bundle. Guarded by a short sessionStorage
 * window so a persistent server-side issue doesn't loop the tab forever.
 */
export function recoverFromStaleDeploy(): boolean {
  const lastAttempt = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
  if (Date.now() - lastAttempt < RELOAD_GUARD_WINDOW_MS) return false;

  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}
