/**
 * Structured logger. In production emits one JSON object per line (ready for a
 * log drain / aggregator such as DigitalOcean, Datadog, or Vector); in dev it
 * prints a readable single line. No PII beyond what the caller passes in `meta`.
 *
 * This is deliberately dependency-free. To ship errors to Sentry later, add the
 * SDK and call it from `error()` — the call sites already funnel through here.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

type Meta = Record<string, unknown>;

function emit(level: LogLevel, scope: string, message: string, meta?: Meta) {
  const isProd = process.env.NODE_ENV === "production";
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (isProd) {
    stream.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        scope,
        message,
        ...(meta ? { meta } : {}),
      }) + "\n",
    );
    return;
  }

  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  stream.write(`[${level}] ${scope}: ${message}${metaStr}\n`);
}

export const log = {
  debug: (scope: string, message: string, meta?: Meta) =>
    emit("debug", scope, message, meta),
  info: (scope: string, message: string, meta?: Meta) =>
    emit("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: Meta) =>
    emit("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: Meta) =>
    emit("error", scope, message, meta),
};
