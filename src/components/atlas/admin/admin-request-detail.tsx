"use client";

import { AssessmentPanel } from "@/components/atlas/admin/assessment-panel";
import { EvaluationActivitiesPanel } from "@/components/atlas/admin/evaluation-activities-panel";
import { EvaluationReportPanel } from "@/components/atlas/admin/evaluation-report-panel";
import { ExternalDeliverablePanel } from "@/components/atlas/admin/external-deliverable-panel";
import { MentionTextarea } from "@/components/atlas/admin/mention-textarea";
import { TechnicalReviewChecklistPanel } from "@/components/atlas/admin/technical-review-checklist-panel";
import { renderMentionBody } from "@/components/atlas/admin/mention-text";
import { DocumentCard, type DocumentVersionView } from "@/components/atlas/document-card";
import { MoneyValue } from "@/components/atlas/money-value";
import { SlaMeter } from "@/components/atlas/sla-meter";
import { StatusRail } from "@/components/atlas/status-rail";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addAdminInternalComment,
  addAtlasClientComment,
  assignRequest,
  completeApplicationReview,
  decideReopenRequest,
  markAdminRequestCommentsRead,
  reopenRequestByAdmin,
  transitionAdminRequest,
} from "@/server/admin/actions";
import { hasCheckItems } from "@/lib/assessment";
import type { AdminRequestDetail, AssignableStaffUser } from "@/server/admin/queries";
import type { FaultAttribution, RequestState, ReturnReasonCode, Role } from "@prisma/client";
import { format } from "date-fns";
import { arSA, enGB } from "date-fns/locale";

const ASSESSMENT_SHOW_STATES: RequestState[] = [
  "ACCEPTED",
  "ASSESSMENT_QUEUED",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
  "REPORT_ISSUED",
  "CLOSED",
  "ON_HOLD",
];

const ASSESSMENT_EDIT_STATES: RequestState[] = [
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
  // ExternalDeliverablePanel's `certificateRequired` (and therefore its
  // visibility for INTERNAL_REPORT services, which are hidden earlier)
  // only turns on at REPORT_ISSUED — it must stay editable here too, or
  // the Evaluator has no way to ever attach the certificate that unblocks
  // REPORT_ISSUED -> CLOSED.
  "REPORT_ISSUED",
];

/**
 * The role actually authorized to act at each stage (per rbac.ts's
 * SPECIALIST_TRANSITIONS) — used to narrow the "Assign to" picker so it
 * doesn't offer, say, a Finance-only staff member for an Evaluation-stage
 * request. SYSTEM_ADMIN can always act, so it's added separately below
 * rather than repeated in every entry. States with no single responsible
 * role (ON_HOLD, terminal states, etc.) are left unfiltered.
 */
const ROLE_FOR_STATE: Partial<Record<RequestState, Role>> = {
  SUBMITTED: "INTAKE_OFFICER",
  UNDER_INTAKE_REVIEW: "INTAKE_OFFICER",
  ASSESSMENT_QUEUED: "EVALUATOR",
  ASSESSMENT_RUNNING: "EVALUATOR",
  REPORT_ISSUED: "EVALUATOR",
  TECHNICAL_REVIEW: "TECHNICAL_REVIEWER",
  DECISION: "DECISION_MAKER",
};

type ReopenTargetState =
  | "SUBMITTED"
  | "UNDER_INTAKE_REVIEW"
  | "RETURNED_TO_CLIENT"
  | "ACCEPTED"
  | "ASSESSMENT_QUEUED"
  | "ASSESSMENT_RUNNING"
  | "TECHNICAL_REVIEW"
  | "DECISION";
import {
  Ban,
  CheckCircle2,
  FileCheck2,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Paperclip,
  PauseCircle,
  RotateCcw,
  Send,
  Unlock,
  UserRoundCog,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

const RETURN_REASON_CODES: ReturnReasonCode[] = [
  "MISSING_ARTWORK",
  "ILLEGIBLE_SCAN",
  "LOW_RESOLUTION",
  "WRONG_PRODUCT_TYPE",
  "MISSING_COA",
  "MISSING_FORMULA",
  "INCOMPLETE_FORMULA",
  "EXPIRED_DOCUMENT",
  "WRONG_LANGUAGE",
  "MISMATCHED_PRODUCT",
  "OTHER",
];

const FAULT_ATTRIBUTIONS: FaultAttribution[] = [
  "CLIENT_FAULT",
  "ATLAS_FAULT",
  "REGULATORY_CHANGE",
];

function storageUrl(key: string) {
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function openStorage(key: string) {
  window.open(storageUrl(key), "_blank", "noopener,noreferrer");
}

function transitionIcon(target: RequestState): LucideIcon {
  switch (target) {
    case "ON_HOLD":
      return PauseCircle;
    case "CANCELLED":
      return Ban;
    case "CLOSED":
      return CheckCircle2;
    case "REPORT_ISSUED":
      return FileCheck2;
    default:
      return Send;
  }
}

type Props = { data: AdminRequestDetail; assignableStaff: AssignableStaffUser[] };

export function AdminRequestDetailPanel({ data, assignableStaff }: Props) {
  const t = useTranslations("adminOps.requestDetail");
  const tStates = useTranslations("states");
  const tReasons = useTranslations("returnReasons");
  const tFault = useTranslations("statusRail");
  const locale = useLocale();
  const dateLocale = locale === "ar" ? arSA : enGB;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const stageRole = ROLE_FOR_STATE[data.state];
  const staffForStageRole = stageRole
    ? assignableStaff.filter(
        (u) =>
          u.roles.includes(stageRole) ||
          u.roles.includes("SYSTEM_ADMIN") ||
          u.id === data.assignedTo?.id,
      )
    : assignableStaff;
  // Fall back to the full list rather than presenting an empty picker if no
  // one currently holds the stage's role (e.g. it hasn't been assigned to
  // any staff member yet) — a narrowed-but-empty dropdown would block
  // assignment entirely instead of just being a helpful default.
  const assignableForStage =
    staffForStageRole.length > 0 ? staffForStageRole : assignableStaff;
  const stageFilterApplied = assignableForStage !== assignableStaff;

  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState<string>(
    data.assignedTo?.id ?? "",
  );
  const [assignPending, startAssignTransition] = useTransition();
  const canAssign = data.state !== "DRAFT";

  function submitAssign(userId: string | null) {
    startAssignTransition(async () => {
      const result = await assignRequest({ requestId: data.id, userId });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      setAssignDialogOpen(false);
      router.refresh();
    });
  }

  const [returnReasons, setReturnReasons] = useState<ReturnReasonCode[]>([]);
  const [returnFault, setReturnFault] = useState<FaultAttribution | "">("");
  const [returnNote, setReturnNote] = useState("");
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

  const [cancelNote, setCancelNote] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const [refuseNote, setRefuseNote] = useState("");
  const [refuseDialogOpen, setRefuseDialogOpen] = useState(false);

  // Conflict-of-interest gate shown before completing Evaluation, completing
  // Technical Review, and saving a Certification Decision (Grant or Refuse).
  const [coiDialogOpen, setCoiDialogOpen] = useState(false);
  const [coiChecked, setCoiChecked] = useState(false);
  const [coiNext, setCoiNext] = useState<
    { kind: "transition"; toState: RequestState } | { kind: "refuse" } | null
  >(null);

  function openCoiGate(next: typeof coiNext) {
    setCoiChecked(false);
    setCoiNext(next);
    setCoiDialogOpen(true);
  }

  function submitCoiGate() {
    if (!coiChecked || !coiNext) return;
    setCoiDialogOpen(false);
    if (coiNext.kind === "transition") {
      runTransition(coiNext.toState, { coiAcknowledged: true });
    } else {
      setRefuseDialogOpen(true);
    }
  }

  const [reopenDecidePending, startReopenDecideTransition] = useTransition();
  const [approveReopenOpen, setApproveReopenOpen] = useState(false);
  const [approveReopenTarget, setApproveReopenTarget] = useState<ReopenTargetState | "">("");
  const [approveReopenNote, setApproveReopenNote] = useState("");
  const [rejectReopenOpen, setRejectReopenOpen] = useState(false);
  const [rejectReopenNote, setRejectReopenNote] = useState("");

  const [adminReopenOpen, setAdminReopenOpen] = useState(false);
  const [adminReopenTarget, setAdminReopenTarget] = useState<ReopenTargetState | "">("");
  const [adminReopenReason, setAdminReopenReason] = useState("");
  const [adminReopenPending, startAdminReopenTransition] = useTransition();

  const [commentBody, setCommentBody] = useState("");
  const [commentFile, setCommentFile] = useState<File | null>(null);
  const [commentPending, startCommentTransition] = useTransition();

  const [clientMessageBody, setClientMessageBody] = useState("");
  const [clientMessagePending, startClientMessageTransition] = useTransition();
  const [clientMessageConfirmOpen, setClientMessageConfirmOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const canMessage = data.state !== "DRAFT" && data.state !== "CANCELLED";

  useEffect(() => {
    if (searchParams.get("openChat") === "1") setChatOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!chatOpen) return;
    void markAdminRequestCommentsRead({ requestId: data.id }).then(
      (result) => {
        if (result.ok) router.refresh();
      },
    );
  }, [chatOpen, data.id, router]);

  const canReturn = data.allowedTransitions.includes("RETURNED_TO_CLIENT");
  const canCancel = data.allowedTransitions.includes("CANCELLED");
  // At DECISION, REPORT_ISSUED/CLOSED are surfaced as the dedicated
  // Grant/Refuse Certification buttons below, not as generic transitions.
  const canDecide = data.state === "DECISION";
  // "Complete Application Review" is a dedicated one-click action (auto-cascades
  // to Evaluation and auto-assigns the Evaluator by service type) — not the
  // generic "Advance to Accepted" transition button.
  const canCompleteApplicationReview =
    data.state === "UNDER_INTAKE_REVIEW" &&
    data.allowedTransitions.includes("ACCEPTED");
  const otherTransitions = data.allowedTransitions.filter(
    (s) =>
      s !== "RETURNED_TO_CLIENT" &&
      s !== "CANCELLED" &&
      !(canDecide && (s === "REPORT_ISSUED" || s === "CLOSED")) &&
      !(canCompleteApplicationReview && s === "ACCEPTED"),
  );

  /** The three transitions the spec requires a Conflict of Interest declaration before. */
  function coiGateFor(target: RequestState): typeof coiNext {
    if (data.state === "ASSESSMENT_RUNNING" && target === "TECHNICAL_REVIEW") {
      return { kind: "transition", toState: target };
    }
    if (data.state === "TECHNICAL_REVIEW" && target === "DECISION") {
      return { kind: "transition", toState: target };
    }
    return null;
  }

  const clientComments = data.comments.filter((c) => c.direction !== "INTERNAL");
  const internalComments = data.comments.filter((c) => c.direction === "INTERNAL");

  function transitionLabel(target: RequestState): string {
    switch (target) {
      case "ON_HOLD":
        return t("hold");
      case "CANCELLED":
        return t("cancel");
      case "CLOSED":
        // REPORT_ISSUED -> CLOSED is the Evaluator's "Complete Certificate
        // Issuance" step; any other route to CLOSED (e.g. admin override)
        // keeps the generic "close" label.
        return data.state === "REPORT_ISSUED"
          ? t("completeCertificateIssuance")
          : t("close");
      case "REPORT_ISSUED":
        return t("issueReport");
      default:
        // Resuming from ON_HOLD can land back in Evaluation, Technical
        // Review, or Decision, not just intake — the label must name the
        // actual stage it's returning to, or a reviewer mid-Evaluation sees
        // "Resume intake" and assumes their hold reset the request.
        if (data.state === "ON_HOLD") return t("resume", { state: tStates(target) });
        return t("advance", { state: tStates(target) });
    }
  }

  function runTransition(toState: RequestState, extra?: Record<string, unknown>) {
    startTransition(async () => {
      const result = await transitionAdminRequest({
        requestId: data.id,
        toState,
        ...extra,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      if (toState === "RETURNED_TO_CLIENT") {
        setReturnReasons([]);
        setReturnFault("");
        setReturnNote("");
        setReturnDialogOpen(false);
      }
      if (toState === "CANCELLED") {
        setCancelNote("");
        setCancelDialogOpen(false);
      }
      if (toState === "CLOSED" && data.state === "DECISION") {
        setRefuseNote("");
        setRefuseDialogOpen(false);
      }
      router.refresh();
    });
  }

  function handleCompleteApplicationReview() {
    startTransition(async () => {
      const result = await completeApplicationReview({ requestId: data.id });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      router.refresh();
    });
  }

  function toggleReturnReason(code: ReturnReasonCode, checked: boolean) {
    setReturnReasons((prev) =>
      checked ? [...prev, code] : prev.filter((c) => c !== code),
    );
  }

  function submitReturn() {
    if (returnReasons.length === 0 || !returnFault) {
      toast.error(t("errors.RETURN_REASON_REQUIRED"));
      return;
    }
    runTransition("RETURNED_TO_CLIENT", {
      reasonCodes: returnReasons,
      faultAttribution: returnFault,
      note: returnNote.trim() || undefined,
    });
  }

  function submitRefuse() {
    const note = refuseNote.trim();
    if (!note) {
      toast.error(t("errors.REFUSAL_REASON_REQUIRED"));
      return;
    }
    runTransition("CLOSED", { note, coiAcknowledged: true });
  }

  function submitCancel() {
    const note = cancelNote.trim();
    if (!note) {
      toast.error(t("errors.CANCEL_NOTE_REQUIRED"));
      return;
    }
    runTransition("CANCELLED", { note });
  }

  function submitApproveReopen() {
    if (!data.pendingReopenRequest || !approveReopenTarget) {
      toast.error(t("errors.TARGET_STATE_REQUIRED"));
      return;
    }
    startReopenDecideTransition(async () => {
      const result = await decideReopenRequest({
        reopenRequestId: data.pendingReopenRequest!.id,
        decision: "APPROVE",
        targetState: approveReopenTarget,
        note: approveReopenNote.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      setApproveReopenOpen(false);
      setApproveReopenTarget("");
      setApproveReopenNote("");
      router.refresh();
    });
  }

  function submitRejectReopen() {
    if (!data.pendingReopenRequest || rejectReopenNote.trim().length === 0) {
      toast.error(t("errors.REJECT_NOTE_REQUIRED"));
      return;
    }
    startReopenDecideTransition(async () => {
      const result = await decideReopenRequest({
        reopenRequestId: data.pendingReopenRequest!.id,
        decision: "REJECT",
        note: rejectReopenNote.trim(),
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      setRejectReopenOpen(false);
      setRejectReopenNote("");
      router.refresh();
    });
  }

  function submitAdminReopen() {
    if (!adminReopenTarget || adminReopenReason.trim().length < 10) {
      toast.error(t("errors.VALIDATION"));
      return;
    }
    startAdminReopenTransition(async () => {
      const result = await reopenRequestByAdmin({
        requestId: data.id,
        targetState: adminReopenTarget,
        reason: adminReopenReason.trim(),
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      setAdminReopenOpen(false);
      setAdminReopenTarget("");
      setAdminReopenReason("");
      router.refresh();
    });
  }

  function submitComment() {
    const body = commentBody.trim();
    if (!body) return;
    startCommentTransition(async () => {
      const formData = new FormData();
      formData.set("requestId", data.id);
      formData.set("body", body);
      if (commentFile) formData.set("file", commentFile);
      const result = await addAdminInternalComment(formData);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      setCommentBody("");
      setCommentFile(null);
      router.refresh();
    });
  }

  function submitClientMessage() {
    const body = clientMessageBody.trim();
    if (!body) return;
    startClientMessageTransition(async () => {
      const result = await addAtlasClientComment({ requestId: data.id, body });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("messageSent"));
      setClientMessageBody("");
      setClientMessageConfirmOpen(false);
      router.refresh();
    });
  }

  const allDocuments = data.items.flatMap((item) => item.documents);

  const onDownload = (version: DocumentVersionView & { storageKey?: string }) => {
    const key =
      allDocuments
        .flatMap((d) => d.versions)
        .find((v) => v.id === version.id)?.storageKey ?? null;
    if (key) openStorage(key);
  };

  const onPreview = onDownload;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-ink-500">{t("client")}</p>
            <p className="font-semibold text-ink-900">
              {locale === "ar" ? data.organisation.nameAr : data.organisation.nameEn}
            </p>
            <p className="text-xs text-ink-500" dir="ltr">
              {data.organisation.email}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-500">{t("service")}</p>
            <p className="font-medium text-ink-900">
              {data.items
                .map((i) =>
                  locale === "ar" ? i.serviceItem.nameAr : i.serviceItem.nameEn,
                )
                .join(", ")}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {t("submission", { n: data.submissionNo })}
              {" · "}
              <MoneyValue amount={data.priceCharged} />
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {t("submittedAt", {
                date: format(
                  new Date(data.submittedAt ?? data.createdAt),
                  "PPp",
                  { locale: dateLocale },
                ),
              })}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-500">{t("assign")}</p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-ink-800">
                {data.assignedTo
                  ? locale === "ar"
                    ? data.assignedTo.fullNameAr
                    : data.assignedTo.fullNameEn
                  : t("unassigned")}
              </p>
              {canAssign ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setAssignUserId(data.assignedTo?.id ?? "");
                    setAssignDialogOpen(true);
                  }}
                >
                  <UserRoundCog className="size-3.5" />
                  {t("assignAction")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end justify-between gap-3">
          <SlaMeter
            dueAt={data.slaDueAt}
            state={data.state}
            startedAt={data.submittedAt}
          />
          {canMessage ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setChatOpen(true)}
            >
              <MessageSquare className="size-4" />
              {t("message")}
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("clientComments")}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-3 overflow-y-auto">
            {clientComments.length === 0 ? (
              <p className="text-sm text-ink-500">{t("commentsEmpty")}</p>
            ) : (
              <ul className="space-y-3">
                {clientComments.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg border border-line bg-surface p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink-900">
                        {locale === "ar" ? c.authorNameAr : c.authorNameEn}
                      </p>
                      <time className="font-data text-xs text-ink-500" dir="ltr">
                        {c.createdAt.slice(0, 16).replace("T", " ")}
                      </time>
                    </div>
                    <p className="mt-2 text-sm text-ink-800">
                      {locale === "ar"
                        ? (c.bodyAr ?? c.bodyEn)
                        : (c.bodyEn ?? c.bodyAr)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canMessage ? (
            <div className="space-y-2 border-t border-line pt-3">
              <Textarea
                id="chat-message"
                value={clientMessageBody}
                onChange={(e) =>
                  setClientMessageBody(e.target.value.slice(0, 2000))
                }
                placeholder={t("messagePlaceholder")}
                maxLength={2000}
                rows={2}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="font-data text-xs text-ink-500" dir="ltr">
                  {t("messageCharCount", { count: clientMessageBody.length })}
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    clientMessagePending || clientMessageBody.trim().length === 0
                  }
                  onClick={() => setClientMessageConfirmOpen(true)}
                >
                  <Send className="size-4" />
                  {t("sendToClient")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {data.allowedTransitions.length > 0 ? (
        <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink-900">{t("actionsTitle")}</h2>

          {canCompleteApplicationReview ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={handleCompleteApplicationReview}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {t("completeApplicationReview")}
              </Button>
            </div>
          ) : null}

          {otherTransitions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {otherTransitions.map((target) => {
                const Icon = transitionIcon(target);
                const gate = coiGateFor(target);
                return (
                  <Button
                    key={target}
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      gate ? openCoiGate(gate) : runTransition(target)
                    }
                  >
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Icon className="size-4" />
                    )}
                    {transitionLabel(target)}
                  </Button>
                );
              })}
            </div>
          ) : null}

          {canDecide ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() =>
                  openCoiGate({ kind: "transition", toState: "REPORT_ISSUED" })
                }
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileCheck2 className="size-4" />
                )}
                {t("grantCertification")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-state-bad/40 text-state-bad hover:bg-[color-mix(in_srgb,var(--state-bad)_6%,white)]"
                disabled={pending}
                onClick={() => openCoiGate({ kind: "refuse" })}
              >
                <XCircle className="size-4" />
                {t("refuseCertification")}
              </Button>
            </div>
          ) : null}

          {canReturn || canCancel ? (
            <div className="flex flex-wrap gap-2">
              {canReturn ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-state-warn/40 text-state-warn hover:bg-[color-mix(in_srgb,var(--state-warn)_6%,white)]"
                  onClick={() => setReturnDialogOpen(true)}
                >
                  <RotateCcw className="size-4" />
                  {t("returnTitle")}
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-state-bad/40 text-state-bad hover:bg-[color-mix(in_srgb,var(--state-bad)_6%,white)]"
                  onClick={() => setCancelDialogOpen(true)}
                >
                  <Ban className="size-4" />
                  {t("cancel")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <Dialog open={coiDialogOpen} onOpenChange={setCoiDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("coiTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-ink-700">{t("coiDescription")}</p>
            <label className="flex items-start gap-2 text-sm text-ink-800">
              <Checkbox
                checked={coiChecked}
                onCheckedChange={(checked) => setCoiChecked(checked === true)}
              />
              {t("coiCheckboxLabel")}
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCoiDialogOpen(false)}
            >
              {t("coiCancel")}
            </Button>
            <Button type="button" disabled={!coiChecked} onClick={submitCoiGate}>
              {t("coiSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refuseDialogOpen} onOpenChange={setRefuseDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("refuseTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-ink-700">{t("refuseDescription")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="refuse-note">{t("refuseNote")}</Label>
              <Textarea
                id="refuse-note"
                value={refuseNote}
                onChange={(e) => setRefuseNote(e.target.value)}
                placeholder={t("refuseNotePlaceholder")}
                maxLength={1000}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRefuseDialogOpen(false)}
            >
              {t("returnCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={submitRefuse}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("refuseSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {data.pendingReopenRequest || data.canReopen ? (
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink-900">
            {t("reopen.title")}
          </h2>

          {data.pendingReopenRequest ? (
            <div className="space-y-2 rounded-md border border-state-warn/40 bg-[color-mix(in_srgb,var(--state-warn)_8%,white)] p-3">
              <p className="text-sm text-ink-800">
                {t("reopen.requestedBy", {
                  name:
                    locale === "ar"
                      ? data.pendingReopenRequest.requestedByNameAr
                      : data.pendingReopenRequest.requestedByNameEn,
                })}
              </p>
              <p className="text-sm text-ink-800">
                {data.pendingReopenRequest.reason}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setApproveReopenOpen(true)}
                >
                  <Unlock className="size-4" />
                  {t("reopen.approve")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-state-bad/40 text-state-bad hover:bg-[color-mix(in_srgb,var(--state-bad)_6%,white)]"
                  onClick={() => setRejectReopenOpen(true)}
                >
                  <XCircle className="size-4" />
                  {t("reopen.reject")}
                </Button>
              </div>
            </div>
          ) : data.canReopen ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdminReopenOpen(true)}
            >
              <Unlock className="size-4" />
              {t("reopen.adminAction")}
            </Button>
          ) : null}
        </section>
      ) : null}

      <Dialog open={approveReopenOpen} onOpenChange={setApproveReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reopen.approveTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("reopen.targetState")}</Label>
              <Select
                value={approveReopenTarget}
                onValueChange={(v) => setApproveReopenTarget(v as ReopenTargetState)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("reopen.targetState")} />
                </SelectTrigger>
                <SelectContent>
                  {data.reopenTargetStates.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tStates(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="approve-reopen-note">{t("reopen.noteOptional")}</Label>
              <Textarea
                id="approve-reopen-note"
                value={approveReopenNote}
                onChange={(e) => setApproveReopenNote(e.target.value)}
                rows={3}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={reopenDecidePending}
              onClick={() => setApproveReopenOpen(false)}
            >
              {t("returnCancel")}
            </Button>
            <Button
              type="button"
              disabled={reopenDecidePending || !approveReopenTarget}
              onClick={submitApproveReopen}
            >
              {reopenDecidePending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unlock className="size-4" />
              )}
              {t("reopen.approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectReopenOpen} onOpenChange={setRejectReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reopen.rejectTitle")}</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="reject-reopen-note">{t("reopen.rejectNote")}</Label>
            <Textarea
              id="reject-reopen-note"
              value={rejectReopenNote}
              onChange={(e) => setRejectReopenNote(e.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={reopenDecidePending}
              onClick={() => setRejectReopenOpen(false)}
            >
              {t("returnCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={reopenDecidePending || rejectReopenNote.trim().length === 0}
              onClick={submitRejectReopen}
            >
              {reopenDecidePending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              {t("reopen.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adminReopenOpen} onOpenChange={setAdminReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reopen.adminTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("reopen.targetState")}</Label>
              <Select
                value={adminReopenTarget}
                onValueChange={(v) => setAdminReopenTarget(v as ReopenTargetState)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("reopen.targetState")} />
                </SelectTrigger>
                <SelectContent>
                  {data.reopenTargetStates.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tStates(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="admin-reopen-reason">{t("reopen.reasonLabel")}</Label>
              <Textarea
                id="admin-reopen-reason"
                value={adminReopenReason}
                onChange={(e) => setAdminReopenReason(e.target.value)}
                rows={3}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={adminReopenPending}
              onClick={() => setAdminReopenOpen(false)}
            >
              {t("returnCancel")}
            </Button>
            <Button
              type="button"
              disabled={adminReopenPending || !adminReopenTarget}
              onClick={submitAdminReopen}
            >
              {adminReopenPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unlock className="size-4" />
              )}
              {t("reopen.adminAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canReturn ? (
        <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("returnTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t("returnReason")}</Label>
                <div className="mt-1 grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
                  {RETURN_REASON_CODES.map((code) => (
                    <label
                      key={code}
                      className="flex items-center gap-2 text-sm text-ink-800"
                    >
                      <Checkbox
                        checked={returnReasons.includes(code)}
                        onCheckedChange={(checked) =>
                          toggleReturnReason(code, checked === true)
                        }
                      />
                      {tReasons(code)}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>{t("returnFault")}</Label>
                <Select
                  value={returnFault}
                  onValueChange={(v) => setReturnFault(v as FaultAttribution)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("returnFault")} />
                  </SelectTrigger>
                  <SelectContent>
                    {FAULT_ATTRIBUTIONS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {tFault(f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="return-note">{t("returnNote")}</Label>
                <Input
                  id="return-note"
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setReturnDialogOpen(false)}
              >
                {t("returnCancel")}
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={submitReturn}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                {t("returnSubmit")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canCancel ? (
        <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("cancelTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-ink-500">{t("cancelDescription")}</p>
              <div>
                <Label htmlFor="cancel-note">{t("cancelNote")}</Label>
                <Textarea
                  id="cancel-note"
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  placeholder={t("cancelNotePlaceholder")}
                  rows={3}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setCancelDialogOpen(false)}
              >
                {t("returnCancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending || cancelNote.trim().length === 0}
                onClick={submitCancel}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Ban className="size-4" />
                )}
                {t("cancelSubmit")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canAssign ? (
        <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("assignAction")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t("assignTo")}</Label>
                <Select value={assignUserId} onValueChange={setAssignUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("assignTo")} />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableForStage.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {locale === "ar" ? u.fullNameAr : u.fullNameEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {stageFilterApplied ? (
                  <p className="mt-1 text-xs text-ink-500">
                    {t("assignToFiltered")}
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              {data.assignedTo ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={assignPending}
                  onClick={() => submitAssign(null)}
                >
                  {t("unassignAction")}
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={assignPending || !assignUserId}
                onClick={() => submitAssign(assignUserId)}
              >
                {assignPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UserRoundCog className="size-4" />
                )}
                {t("assignSubmit")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {["TECHNICAL_REVIEW", "DECISION", "REPORT_ISSUED", "CLOSED"].includes(
        data.state,
      ) && hasCheckItems(data.technicalReviewChecklist.checkSets) ? (
        <TechnicalReviewChecklistPanel
          requestId={data.id}
          checkSets={data.technicalReviewChecklist.checkSets}
          initial={data.technicalReviewChecklist.results}
          editable={data.state === "TECHNICAL_REVIEW"}
        />
      ) : null}

      {ASSESSMENT_SHOW_STATES.includes(data.state)
        ? data.items
            .filter((item) => hasCheckItems(item.serviceItem.checkSets))
            .map((item) => (
              <AssessmentPanel
                key={item.id}
                requestItemId={item.id}
                title={
                  locale === "ar" ? item.serviceItem.nameAr : item.serviceItem.nameEn
                }
                checkSets={item.serviceItem.checkSets}
                initial={item.assessment}
                editable={ASSESSMENT_EDIT_STATES.includes(data.state)}
              />
            ))
        : null}

      {ASSESSMENT_SHOW_STATES.includes(data.state)
        ? data.items.map((item) => (
            <EvaluationReportPanel
              key={item.id}
              requestItemId={item.id}
              title={
                locale === "ar" ? item.serviceItem.nameAr : item.serviceItem.nameEn
              }
              documents={item.documents}
              editable={data.state === "ASSESSMENT_RUNNING"}
            />
          ))
        : null}

      {ASSESSMENT_SHOW_STATES.includes(data.state)
        ? data.items.map((item) => (
            <EvaluationActivitiesPanel
              key={item.id}
              requestItemId={item.id}
              title={
                locale === "ar" ? item.serviceItem.nameAr : item.serviceItem.nameEn
              }
              serviceItem={item.serviceItem}
              activities={item.activities}
              assignableStaff={assignableStaff}
              editable={ASSESSMENT_EDIT_STATES.includes(data.state)}
              locale={locale}
            />
          ))
        : null}

      {ASSESSMENT_SHOW_STATES.includes(data.state)
        ? data.items.map((item) => (
            <ExternalDeliverablePanel
              key={item.id}
              requestItemId={item.id}
              title={
                locale === "ar" ? item.serviceItem.nameAr : item.serviceItem.nameEn
              }
              serviceItem={item.serviceItem}
              certificateRequired={
                data.state === "REPORT_ISSUED" || data.state === "CLOSED"
              }
              deliverable={item.externalDeliverable}
              editable={ASSESSMENT_EDIT_STATES.includes(data.state)}
              locale={locale}
            />
          ))
        : null}

      <StatusRail
        events={data.events.map((e) => ({
          id: e.id,
          fromState: e.fromState,
          toState: e.toState,
          actorName: locale === "ar" ? e.actorNameAr : e.actorNameEn,
          actorRole: e.actorRole,
          note: e.note,
          reasonCodes: e.reasonCodes,
          faultAttribution: e.faultAttribution,
          createdAt: e.createdAt,
        }))}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">{t("documents")}</h2>
        {allDocuments.filter((d) => d.currentVersion).length === 0 ? (
          <p className="text-sm text-ink-500">{t("documentsEmpty")}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {allDocuments
              .filter((d) => d.currentVersion)
              .map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={{
                    id: doc.id,
                    label: doc.label,
                    currentVersion: doc.currentVersion
                      ? {
                          id: doc.currentVersion.id,
                          version: doc.currentVersion.version,
                          fileName: doc.currentVersion.fileName,
                          mimeType: doc.currentVersion.mimeType,
                          sizeBytes: doc.currentVersion.sizeBytes,
                          uploadedByName:
                            locale === "ar"
                              ? doc.currentVersion.uploadedByNameAr
                              : doc.currentVersion.uploadedByNameEn,
                          uploadedAt: doc.currentVersion.uploadedAt,
                        }
                      : null,
                    versions: doc.versions.map((v) => ({
                      id: v.id,
                      version: v.version,
                      fileName: v.fileName,
                      mimeType: v.mimeType,
                      sizeBytes: v.sizeBytes,
                      uploadedByName:
                        locale === "ar" ? v.uploadedByNameAr : v.uploadedByNameEn,
                      uploadedAt: v.uploadedAt,
                    })),
                  }}
                  onDownload={onDownload}
                  onPreview={onPreview}
                />
              ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">{t("clientComments")}</h2>
        {clientComments.length === 0 ? (
          <p className="text-sm text-ink-500">{t("commentsEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {clientComments.map((c) => (
              <li key={c.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">
                    {locale === "ar" ? c.authorNameAr : c.authorNameEn}
                  </p>
                  <time className="font-data text-xs text-ink-500" dir="ltr">
                    {c.createdAt.slice(0, 16).replace("T", " ")}
                  </time>
                </div>
                <p className="mt-2 text-sm text-ink-800">
                  {locale === "ar" ? (c.bodyAr ?? c.bodyEn) : (c.bodyEn ?? c.bodyAr)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canMessage ? (
          <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
            <Label htmlFor="client-message">{t("sendToClient")}</Label>
            <Textarea
              id="client-message"
              value={clientMessageBody}
              onChange={(e) => setClientMessageBody(e.target.value.slice(0, 2000))}
              placeholder={t("messagePlaceholder")}
              maxLength={2000}
              rows={3}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="font-data text-xs text-ink-500" dir="ltr">
                {t("messageCharCount", { count: clientMessageBody.length })}
              </p>
              <Button
                type="button"
                size="sm"
                disabled={
                  clientMessagePending || clientMessageBody.trim().length === 0
                }
                onClick={() => setClientMessageConfirmOpen(true)}
              >
                <Send className="size-4" />
                {t("sendToClient")}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <Dialog open={clientMessageConfirmOpen} onOpenChange={setClientMessageConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmSendTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-ink-600">{t("confirmSendBody")}</p>
            <p className="whitespace-pre-wrap rounded-lg border border-line bg-atlas-green-tint/40 p-3 text-sm text-ink-900">
              {clientMessageBody}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={clientMessagePending}
              onClick={() => setClientMessageConfirmOpen(false)}
            >
              {t("confirmSendCancel")}
            </Button>
            <Button
              type="button"
              disabled={clientMessagePending}
              onClick={submitClientMessage}
            >
              {clientMessagePending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {t("confirmSendConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">
          {t("internalComments")}
        </h2>
        {internalComments.length === 0 ? (
          <p className="text-sm text-ink-500">{t("internalCommentsEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {internalComments.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-line bg-atlas-green-tint/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">
                    {locale === "ar" ? c.authorNameAr : c.authorNameEn}
                  </p>
                  <time className="font-data text-xs text-ink-500" dir="ltr">
                    {c.createdAt.slice(0, 16).replace("T", " ")}
                  </time>
                </div>
                <p className="mt-2 text-sm text-ink-800">
                  {renderMentionBody(
                    locale === "ar" ? (c.bodyAr ?? c.bodyEn ?? "") : (c.bodyEn ?? c.bodyAr ?? ""),
                    c.mentions,
                    locale === "ar" ? "ar" : "en",
                  )}
                </p>
                {c.attachments.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.attachments.map((a) => (
                      <button
                        key={a.storageKey}
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-atlas-green-tint/40"
                        onClick={() => openStorage(a.storageKey)}
                      >
                        <Paperclip className="size-3.5" />
                        {a.fileName}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
          <Label htmlFor="internal-comment">{t("comment")}</Label>
          <MentionTextarea
            id="internal-comment"
            value={commentBody}
            onChange={setCommentBody}
            staff={assignableStaff}
            placeholder={t("commentPlaceholder")}
            rows={3}
            locale={locale === "ar" ? "ar" : "en"}
            emptyLabel={t("commentMentionEmpty")}
          />
          {commentFile ? (
            <div className="flex items-center gap-1.5 text-xs text-ink-600">
              <Paperclip className="size-3.5" />
              {commentFile.name}
              <button
                type="button"
                className="text-ink-500 hover:text-ink-800"
                onClick={() => setCommentFile(null)}
                aria-label={t("commentAttachmentRemove")}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={commentPending || commentBody.trim().length === 0}
              onClick={submitComment}
            >
              {commentPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MessageSquarePlus className="size-4" />
              )}
              {t("commentSubmit")}
            </Button>
            <Label
              htmlFor="internal-comment-file"
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-700 hover:bg-atlas-green-tint/40"
            >
              <Paperclip className="size-3.5" />
              {t("commentAttach")}
            </Label>
            <input
              id="internal-comment-file"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => setCommentFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
