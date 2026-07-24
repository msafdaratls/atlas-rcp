import type { RequestState } from "@prisma/client";
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Gavel,
  Hourglass,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type StateTone =
  | "neutral"
  | "info"
  | "ok"
  | "warn"
  | "bad"
  | "gap";

export type StateMeta = {
  tone: StateTone;
  icon: LucideIcon;
  /** Message keys under `states.*` — never hardcode UI labels here. */
  labelKey: RequestState;
};

/**
 * Single source of truth for request-state colour + icon.
 * Labels come from next-intl (`states.<STATE>`).
 */
export const STATE_META: Record<RequestState, StateMeta> = {
  DRAFT: { tone: "neutral", icon: FileText, labelKey: "DRAFT" },
  SUBMITTED: { tone: "info", icon: Send, labelKey: "SUBMITTED" },
  UNDER_INTAKE_REVIEW: {
    tone: "info",
    icon: ClipboardCheck,
    labelKey: "UNDER_INTAKE_REVIEW",
  },
  RETURNED_TO_CLIENT: {
    tone: "warn",
    icon: RotateCcw,
    labelKey: "RETURNED_TO_CLIENT",
  },
  ACCEPTED: { tone: "ok", icon: CheckCircle2, labelKey: "ACCEPTED" },
  ASSESSMENT_QUEUED: {
    tone: "info",
    icon: Hourglass,
    labelKey: "ASSESSMENT_QUEUED",
  },
  ASSESSMENT_RUNNING: {
    tone: "info",
    icon: PlayCircle,
    labelKey: "ASSESSMENT_RUNNING",
  },
  TECHNICAL_REVIEW: {
    tone: "gap",
    icon: ShieldCheck,
    labelKey: "TECHNICAL_REVIEW",
  },
  DECISION: { tone: "gap", icon: Gavel, labelKey: "DECISION" },
  REPORT_ISSUED: { tone: "ok", icon: FileCheck2, labelKey: "REPORT_ISSUED" },
  CLOSED: { tone: "neutral", icon: CircleDashed, labelKey: "CLOSED" },
  CANCELLED: { tone: "bad", icon: Ban, labelKey: "CANCELLED" },
  ON_HOLD: { tone: "warn", icon: PauseCircle, labelKey: "ON_HOLD" },
};

export const STATE_TONE_CLASS: Record<StateTone, string> = {
  neutral: "bg-surface-alt text-ink-500 border-line",
  info: "bg-[color-mix(in_srgb,var(--state-info)_12%,white)] text-state-info border-[color-mix(in_srgb,var(--state-info)_30%,white)]",
  ok: "bg-[color-mix(in_srgb,var(--state-ok)_12%,white)] text-state-ok border-[color-mix(in_srgb,var(--state-ok)_30%,white)]",
  warn: "bg-[color-mix(in_srgb,var(--state-warn)_12%,white)] text-state-warn border-[color-mix(in_srgb,var(--state-warn)_30%,white)]",
  bad: "bg-[color-mix(in_srgb,var(--state-bad)_12%,white)] text-state-bad border-[color-mix(in_srgb,var(--state-bad)_30%,white)]",
  gap: "bg-[color-mix(in_srgb,var(--state-gap)_12%,white)] text-state-gap border-[color-mix(in_srgb,var(--state-gap)_30%,white)]",
};

export const STATE_TONE_DOT: Record<StateTone, string> = {
  neutral: "bg-state-neutral",
  info: "bg-state-info",
  ok: "bg-state-ok",
  warn: "bg-state-warn",
  bad: "bg-state-bad",
  gap: "bg-state-gap",
};
