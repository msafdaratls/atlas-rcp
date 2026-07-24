/**
 * Next.js instrumentation — notification cron (Node runtime only).
 * Runs by default; set NOTIFICATIONS_WORKER=0 to disable.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.NOTIFICATIONS_WORKER === "0") return;

  // Relative import so Turbopack/Node resolve without the `@/` alias at runtime.
  const { startNotificationJobs } = await import(
    "./server/notifications/jobs"
  );
  startNotificationJobs();
}
