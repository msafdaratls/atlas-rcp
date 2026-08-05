"use client";

import { AssessmentPanel } from "@/components/atlas/admin/assessment-panel";
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
  transitionAdminRequest,
} from "@/server/admin/actions";
import { hasCheckItems } from "@/lib/assessment";
import type { AdminRequestDetail, AssignableStaffUser } from "@/server/admin/queries";
import type { FaultAttribution, RequestState, ReturnReasonCode } from "@prisma/client";
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
];
import {
  Ban,
  CheckCircle2,
  FileCheck2,
  Loader2,
  MessageSquarePlus,
  PauseCircle,
  RotateCcw,
  Send,
  UserRoundCog,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  const [pending, startTransition] = useTransition();

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

  const [commentBody, setCommentBody] = useState("");
  const [commentPending, startCommentTransition] = useTransition();

  const [clientMessageBody, setClientMessageBody] = useState("");
  const [clientMessagePending, startClientMessageTransition] = useTransition();
  const [clientMessageConfirmOpen, setClientMessageConfirmOpen] = useState(false);

  const canMessage = data.state !== "DRAFT" && data.state !== "CANCELLED";

  const canReturn = data.allowedTransitions.includes("RETURNED_TO_CLIENT");
  const canCancel = data.allowedTransitions.includes("CANCELLED");
  const otherTransitions = data.allowedTransitions.filter(
    (s) => s !== "RETURNED_TO_CLIENT" && s !== "CANCELLED",
  );

  const clientComments = data.comments.filter((c) => c.direction !== "INTERNAL");
  const internalComments = data.comments.filter((c) => c.direction === "INTERNAL");

  function transitionLabel(target: RequestState): string {
    switch (target) {
      case "ON_HOLD":
        return t("hold");
      case "CANCELLED":
        return t("cancel");
      case "CLOSED":
        return t("close");
      case "REPORT_ISSUED":
        return t("issueReport");
      default:
        if (data.state === "ON_HOLD") return t("resume");
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

  function submitCancel() {
    const note = cancelNote.trim();
    if (!note) {
      toast.error(t("errors.CANCEL_NOTE_REQUIRED"));
      return;
    }
    runTransition("CANCELLED", { note });
  }

  function submitComment() {
    const body = commentBody.trim();
    if (!body) return;
    startCommentTransition(async () => {
      const result = await addAdminInternalComment({ requestId: data.id, body });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      setCommentBody("");
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

  const onDownload = (version: DocumentVersionView & { storageKey?: string }) => {
    const key =
      data.documents
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
              {locale === "ar" ? data.serviceItem.nameAr : data.serviceItem.nameEn}
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
        <SlaMeter
          dueAt={data.slaDueAt}
          state={data.state}
          startedAt={data.submittedAt}
        />
      </div>

      {data.allowedTransitions.length > 0 ? (
        <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink-900">{t("actionsTitle")}</h2>

          {otherTransitions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {otherTransitions.map((target) => {
                const Icon = transitionIcon(target);
                return (
                  <Button
                    key={target}
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => runTransition(target)}
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
                    {assignableStaff.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {locale === "ar" ? u.fullNameAr : u.fullNameEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

      {ASSESSMENT_SHOW_STATES.includes(data.state) &&
      hasCheckItems(data.serviceItem.checkSets) ? (
        <AssessmentPanel
          requestId={data.id}
          checkSets={data.serviceItem.checkSets}
          initial={data.assessment}
          editable={ASSESSMENT_EDIT_STATES.includes(data.state)}
        />
      ) : null}

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
        {data.documents.filter((d) => d.currentVersion).length === 0 ? (
          <p className="text-sm text-ink-500">{t("documentsEmpty")}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.documents
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
                  {locale === "ar" ? (c.bodyAr ?? c.bodyEn) : (c.bodyEn ?? c.bodyAr)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
          <Label htmlFor="internal-comment">{t("comment")}</Label>
          <Textarea
            id="internal-comment"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder={t("commentPlaceholder")}
            rows={3}
          />
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
        </div>
      </section>
    </div>
  );
}
