import cron from "node-cron";
import { log } from "@/lib/logger";
import { processExtractionJobBatch } from "@/server/label-eval/extraction/worker";
import { reclaimStalledAssessments } from "@/server/label-eval/recovery";

let started = false;

export function startLabelEvalJobs(): void {
  if (started) return;
  if (process.env.LABEL_EVAL_WORKER === "0") return;
  started = true;

  log.info("label-eval.cron", "label evaluator extraction worker started");

  cron.schedule("*/15 * * * * *", () => {
    void processExtractionJobBatch().catch((e) =>
      log.error("label-eval.cron", "processExtractionJobBatch failed", {
        error: e instanceof Error ? e.message : "unknown",
      }),
    );
  });

  // Frees assessments a crashed run left stranded in a transient status
  // (recovery.ts). Nothing is urgent here — the stall threshold is ten
  // minutes — so this runs once a minute rather than on the extraction tick,
  // and is scheduled separately so a failure in one sweep cannot suppress
  // the other.
  cron.schedule("30 * * * * *", () => {
    void reclaimStalledAssessments().catch((e) =>
      log.error("label-eval.cron", "reclaimStalledAssessments failed", {
        error: e instanceof Error ? e.message : "unknown",
      }),
    );
  });
}
