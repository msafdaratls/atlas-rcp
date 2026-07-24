import cron from "node-cron";
import { processOutboxBatch } from "@/server/notifications/worker";
import {
  scanSlaNotifications,
  scanStatementOverdue,
} from "@/server/notifications/sla-scanner";

let started = false;

export function startNotificationJobs(): void {
  if (started) return;
  if (process.env.NOTIFICATIONS_WORKER === "0") return;
  started = true;

  cron.schedule("*/30 * * * * *", () => {
    void processOutboxBatch().catch(() => {
      /* swallow — next tick retries */
    });
  });

  cron.schedule("*/15 * * * *", () => {
    void scanSlaNotifications().catch(() => {
      /* swallow */
    });
    void scanStatementOverdue().catch(() => {
      /* swallow */
    });
  });
}
