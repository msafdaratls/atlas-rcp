/**
 * Standalone notification jobs (outbox drain + SLA scan).
 * Prefer Next instrumentation for app-coupled cron; use this for dedicated process.
 *
 *   npm run jobs
 */
import { startNotificationJobs } from "../src/server/notifications/jobs";
import { processOutboxBatch } from "../src/server/notifications/worker";
import { scanSlaNotifications } from "../src/server/notifications/sla-scanner";

async function main() {
  startNotificationJobs();
  await processOutboxBatch();
  await scanSlaNotifications();
  // Keep process alive for cron schedules
}

void main();
