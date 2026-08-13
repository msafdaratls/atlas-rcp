import cron from "node-cron";
import { log } from "@/lib/logger";
import { processExtractionJobBatch } from "@/server/label-eval/extraction/worker";

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
}
