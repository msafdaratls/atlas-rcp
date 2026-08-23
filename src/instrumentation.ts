/**
 * Next.js instrumentation — notification + label-evaluator cron (Node
 * runtime only). Runs by default; set NOTIFICATIONS_WORKER=0 /
 * LABEL_EVAL_WORKER=0 to disable each independently.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  // Relative imports so Turbopack/Node resolve without the `@/` alias at runtime.
  if (process.env.NODE_ENV === "production") {
    const { avEnabled } = await import("./lib/av");
    if (!avEnabled()) {
      const { log } = await import("./lib/logger");
      log.warn(
        "boot",
        "AV_DRIVER=none in production — uploaded files are not scanned for malware. Set AV_DRIVER=clamav to enable scanning.",
      );
    }
  }

  if (process.env.NOTIFICATIONS_WORKER !== "0") {
    const { startNotificationJobs } = await import(
      "./server/notifications/jobs"
    );
    startNotificationJobs();
  }

  if (process.env.LABEL_EVAL_WORKER !== "0") {
    const { startLabelEvalJobs } = await import("./server/label-eval/jobs");
    startLabelEvalJobs();
  }
}
