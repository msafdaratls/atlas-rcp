import cron from "node-cron";
import { log } from "@/lib/logger";
import { processOutboxBatch } from "@/server/notifications/worker";
import {
  scanSlaNotifications,
  scanStatementOverdue,
} from "@/server/notifications/sla-scanner";

let started = false;

function logJobError(job: string, error: unknown): void {
  log.error("notifications.cron", `${job} failed`, {
    error: error instanceof Error ? error.message : "unknown",
  });
}

export function startNotificationJobs(): void {
  if (started) return;
  if (process.env.NOTIFICATIONS_WORKER === "0") return;
  started = true;

  log.info("notifications.cron", "notification worker started");

  cron.schedule("*/30 * * * * *", () => {
    void processOutboxBatch().catch((e) => logJobError("processOutboxBatch", e));
  });

  cron.schedule("*/15 * * * *", () => {
    void scanSlaNotifications().catch((e) =>
      logJobError("scanSlaNotifications", e),
    );
    void scanStatementOverdue().catch((e) =>
      logJobError("scanStatementOverdue", e),
    );
  });
}
