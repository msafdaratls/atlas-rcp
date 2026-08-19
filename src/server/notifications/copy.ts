/**
 * Bilingual notification copy for in-app + email (server-side; no next-intl).
 * Template vars use `{name}` placeholders.
 */

export type NotificationCopyKey =
  | "REQUEST_SUBMITTED"
  | "REQUEST_RECEIVED"
  | "REQUEST_RESUBMITTED"
  | "REQUEST_RETURNED"
  | "REQUEST_ACCEPTED"
  | "REQUEST_ASSIGNED"
  | "TECHNICAL_REVIEW_READY"
  | "DECISION_READY"
  | "CERTIFICATE_GRANTED"
  | "REPORT_ISSUED"
  | "CERTIFICATE_REFUSED"
  | "REQUEST_CLOSED"
  | "INVOICE_ISSUED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_REJECTED"
  | "SLA_AT_RISK"
  | "SLA_BREACHED"
  | "COMMENT_ADDED_FROM_CLIENT"
  | "COMMENT_ADDED_FROM_ATLAS"
  | "NOTE_MENTION"
  | "CREDIT_LIMIT"
  | "STATEMENT_OVERDUE"
  | "REOPEN_REQUESTED"
  | "REOPEN_DECIDED_APPROVED"
  | "REOPEN_DECIDED_REJECTED";

export type NotificationCopyVars = {
  requestNo?: string;
  invoiceNo?: string;
  amount?: string;
  reason?: string;
  message?: string;
  slaHours?: string;
  authorName?: string;
  /**
   * Client organisation name, required on every workflow-status
   * notification. Both language variants are needed because titleEn/bodyEn
   * and titleAr/bodyAr are interpolated from the same vars object before
   * per-recipient locale is known — the {customerNameEn} placeholder feeds
   * the English template, {customerNameAr} the Arabic one.
   */
  customerNameEn?: string;
  customerNameAr?: string;
  /** Requested service's display name — same EN/AR split as customerName above. */
  serviceNameEn?: string;
  serviceNameAr?: string;
};

export type NotificationCopy = {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  ctaLabelEn?: string;
  ctaLabelAr?: string;
};

const CATALOG: Record<NotificationCopyKey, NotificationCopy> = {
  REQUEST_SUBMITTED: {
    titleEn: "New request submitted",
    titleAr: "طلب جديد مُقدَّم",
    bodyEn:
      "{requestNo} ({serviceNameEn}) from {customerNameEn} awaits intake review. Required action: Start Application Review.",
    bodyAr:
      "{requestNo} ({serviceNameAr}) من العميل {customerNameAr} بانتظار مراجعة الاستلام. الإجراء المطلوب: بدء مراجعة الطلب.",
    ctaLabelEn: "Open in intake",
    ctaLabelAr: "فتح في الاستلام",
  },
  REQUEST_RECEIVED: {
    titleEn: "Thank you for choosing Atlas",
    titleAr: "شكراً لاختياركم أطلس",
    bodyEn:
      "This is to confirm that we have received your request {requestNo}. It is now in our processing queue and will be handled within the {slaHours}-hour SLA for this service. We appreciate your trust in Atlas and will notify you as it progresses.",
    bodyAr:
      "نود إبلاغكم بأننا استلمنا طلبكم {requestNo}، وهو الآن ضمن قائمة المعالجة لدينا وسيتم إنجازه خلال مدة مستوى الخدمة المحددة بـ {slaHours} ساعة لهذه الخدمة. نشكر لكم ثقتكم بأطلس وسنوافيكم بآخر مستجدات طلبكم.",
    ctaLabelEn: "Track your request",
    ctaLabelAr: "تتبع طلبك",
  },
  REQUEST_RESUBMITTED: {
    titleEn: "Request resubmitted",
    titleAr: "أُعيد تقديم الطلب",
    bodyEn:
      "{requestNo} ({serviceNameEn}) from {customerNameEn} was resubmitted after client corrections. Required action: Resume Application Review.",
    bodyAr:
      "أُعيد تقديم {requestNo} ({serviceNameAr}) من العميل {customerNameAr} بعد تصحيحات العميل. الإجراء المطلوب: استئناف مراجعة الطلب.",
    ctaLabelEn: "Open in intake",
    ctaLabelAr: "فتح في الاستلام",
  },
  REQUEST_RETURNED: {
    titleEn: "Request returned",
    titleAr: "تم إرجاع الطلب",
    bodyEn:
      "{requestNo} ({serviceNameEn}): Your request was returned for corrections. Required action: Upload the missing information and resubmit.",
    bodyAr:
      "{requestNo} ({serviceNameAr}): تم إرجاع طلبك لإجراء تصحيحات. الإجراء المطلوب: تحميل المعلومات الناقصة وإعادة التقديم.",
  },
  REQUEST_ACCEPTED: {
    titleEn: "Request accepted",
    titleAr: "تم قبول الطلب",
    bodyEn:
      "{requestNo}: Your request passed intake review and moved to assessment.",
    bodyAr: "{requestNo}: تجاوز طلبك مراجعة الاستلام وانتقل إلى التقييم.",
  },
  REQUEST_ASSIGNED: {
    titleEn: "Request assigned",
    titleAr: "تم تعيين طلب",
    bodyEn:
      "{requestNo} ({serviceNameEn}) from {customerNameEn} was assigned to you. Required action: Review and proceed with the next step.",
    bodyAr:
      "تم تعيين {requestNo} ({serviceNameAr}) من العميل {customerNameAr} لك. الإجراء المطلوب: المراجعة والمتابعة للخطوة التالية.",
    ctaLabelEn: "Open queue item",
    ctaLabelAr: "فتح عنصر الطابور",
  },
  TECHNICAL_REVIEW_READY: {
    titleEn: "Ready for technical review",
    titleAr: "جاهز للمراجعة الفنية",
    bodyEn:
      "{requestNo} ({serviceNameEn}) from {customerNameEn}: Evaluation is complete and awaiting technical review. Required action: Perform Technical Review.",
    bodyAr:
      "{requestNo} ({serviceNameAr}) من العميل {customerNameAr}: اكتمل التقييم وهو بانتظار المراجعة الفنية. الإجراء المطلوب: إجراء المراجعة الفنية.",
    ctaLabelEn: "Open queue item",
    ctaLabelAr: "فتح عنصر الطابور",
  },
  DECISION_READY: {
    titleEn: "Ready for decision",
    titleAr: "جاهز لاتخاذ القرار",
    bodyEn:
      "{requestNo} ({serviceNameEn}) from {customerNameEn}: Technical review is complete and awaiting a certification decision. Required action: Grant or Refuse the Certificate of Conformity.",
    bodyAr:
      "{requestNo} ({serviceNameAr}) من العميل {customerNameAr}: اكتملت المراجعة الفنية وهي بانتظار قرار المطابقة. الإجراء المطلوب: منح أو رفض شهادة المطابقة.",
    ctaLabelEn: "Open queue item",
    ctaLabelAr: "فتح عنصر الطابور",
  },
  CERTIFICATE_GRANTED: {
    titleEn: "Certificate granted — issuance needed",
    titleAr: "تم منح الشهادة — بانتظار الإصدار",
    bodyEn:
      "{requestNo} ({serviceNameEn}) from {customerNameEn}: Certification was granted. Required action: Obtain the certificate from the external platform and complete issuance.",
    bodyAr:
      "{requestNo} ({serviceNameAr}) من العميل {customerNameAr}: تم منح شهادة المطابقة. الإجراء المطلوب: استخراج الشهادة من المنصة الخارجية وإكمال إصدارها.",
    ctaLabelEn: "Open queue item",
    ctaLabelAr: "فتح عنصر الطابور",
  },
  REPORT_ISSUED: {
    titleEn: "Certificate issued",
    titleAr: "تم إصدار الشهادة",
    bodyEn:
      "{requestNo} ({serviceNameEn}): Your certificate of conformity is ready. Required action: Download it from the Customer Portal.",
    bodyAr:
      "{requestNo} ({serviceNameAr}): شهادة المطابقة جاهزة الآن. الإجراء المطلوب: تنزيلها من بوابة العملاء.",
  },
  CERTIFICATE_REFUSED: {
    titleEn: "Certification refused",
    titleAr: "تم رفض شهادة المطابقة",
    bodyEn:
      "{requestNo} ({serviceNameEn}) from {customerNameEn}: Certification was refused. Reason: {reason}",
    bodyAr:
      "{requestNo} ({serviceNameAr}) من العميل {customerNameAr}: تم رفض شهادة المطابقة. السبب: {reason}",
    ctaLabelEn: "Open request",
    ctaLabelAr: "فتح الطلب",
  },
  REQUEST_CLOSED: {
    titleEn: "Request closed",
    titleAr: "تم إغلاق الطلب",
    bodyEn:
      "{requestNo} ({serviceNameEn}) is now closed. Documents and certificates remain available for download.",
    bodyAr:
      "{requestNo} ({serviceNameAr}) مغلق الآن. تبقى المستندات والشهادات متاحة للتنزيل.",
    ctaLabelEn: "Open request",
    ctaLabelAr: "فتح الطلب",
  },
  INVOICE_ISSUED: {
    titleEn: "Pro forma invoice issued",
    titleAr: "إصدار فاتورة مبدئية",
    bodyEn: "Pro forma invoice {invoiceNo} for {requestNo} — SAR {amount}.",
    bodyAr: "فاتورة مبدئية {invoiceNo} للطلب {requestNo} — {amount} ر.س.",
    ctaLabelEn: "View statement",
    ctaLabelAr: "عرض كشف الحساب",
  },
  PAYMENT_RECEIVED: {
    titleEn: "Payment confirmed",
    titleAr: "تأكيد الدفعة",
    bodyEn: "A payment of SAR {amount} was confirmed.",
    bodyAr: "تم تأكيد دفعة بمبلغ {amount} ر.س.",
    ctaLabelEn: "View statement",
    ctaLabelAr: "عرض كشف الحساب",
  },
  PAYMENT_REJECTED: {
    titleEn: "Payment rejected",
    titleAr: "تم رفض الدفعة",
    bodyEn: "Your payment of SAR {amount} was rejected: {reason}",
    bodyAr: "تم رفض دفعتك بمبلغ {amount} ر.س: {reason}",
    ctaLabelEn: "View statement",
    ctaLabelAr: "عرض كشف الحساب",
  },
  SLA_AT_RISK: {
    titleEn: "SLA at risk",
    titleAr: "تنبيه مستوى الخدمة",
    bodyEn: "{requestNo} has used 80% or more of its SLA window.",
    bodyAr: "{requestNo} استهلك 80٪ أو أكثر من نافذة مستوى الخدمة.",
    ctaLabelEn: "Open queue item",
    ctaLabelAr: "فتح عنصر الطابور",
  },
  SLA_BREACHED: {
    titleEn: "SLA breached",
    titleAr: "تجاوز مستوى الخدمة",
    bodyEn: "{requestNo} has passed its SLA due time.",
    bodyAr: "{requestNo} تجاوز موعد مستوى الخدمة.",
    ctaLabelEn: "Open queue item",
    ctaLabelAr: "فتح عنصر الطابور",
  },
  COMMENT_ADDED_FROM_CLIENT: {
    titleEn: "New client message",
    titleAr: "رسالة جديدة من العميل",
    bodyEn: "{requestNo}: {message}",
    bodyAr: "{requestNo}: {message}",
    ctaLabelEn: "Open request",
    ctaLabelAr: "فتح الطلب",
  },
  COMMENT_ADDED_FROM_ATLAS: {
    titleEn: "New message from Atlas",
    titleAr: "رسالة جديدة من أطلس",
    bodyEn: "{requestNo}: {message}",
    bodyAr: "{requestNo}: {message}",
    ctaLabelEn: "Open request",
    ctaLabelAr: "فتح الطلب",
  },
  NOTE_MENTION: {
    titleEn: "You were mentioned",
    titleAr: "تمت الإشارة إليك",
    bodyEn: "{authorName} mentioned you in a note on {requestNo}.",
    bodyAr: "أشار إليك {authorName} في ملاحظة على الطلب {requestNo}.",
    ctaLabelEn: "Open request",
    ctaLabelAr: "فتح الطلب",
  },
  CREDIT_LIMIT: {
    titleEn: "Credit limit reached",
    titleAr: "تم الوصول إلى الحد الائتماني",
    bodyEn:
      "Your organisation's balance has exceeded its credit limit. New submissions are on hold until the balance is settled.",
    bodyAr:
      "تجاوز رصيد مؤسستكم الحد الائتماني. الطلبات الجديدة معلّقة حتى تسوية الرصيد.",
    ctaLabelEn: "View statement",
    ctaLabelAr: "عرض كشف الحساب",
  },
  STATEMENT_OVERDUE: {
    titleEn: "Statement overdue",
    titleAr: "تأخر كشف الحساب",
    bodyEn: "Pro forma invoice {invoiceNo} is past due (open balance SAR {amount}).",
    bodyAr: "الفاتورة المبدئية {invoiceNo} متأخرة (الرصيد المفتوح {amount} ر.س).",
    ctaLabelEn: "View statement",
    ctaLabelAr: "عرض كشف الحساب",
  },
  REOPEN_REQUESTED: {
    titleEn: "Reopen requested",
    titleAr: "طلب إعادة فتح",
    bodyEn: "{requestNo}: The client asked to reopen this closed request.",
    bodyAr: "{requestNo}: طلب العميل إعادة فتح هذا الطلب المغلق.",
    ctaLabelEn: "Review request",
    ctaLabelAr: "مراجعة الطلب",
  },
  REOPEN_DECIDED_APPROVED: {
    titleEn: "Reopen approved",
    titleAr: "تمت الموافقة على إعادة الفتح",
    bodyEn: "{requestNo}: Your reopen request was approved. The request is active again.",
    bodyAr: "{requestNo}: تمت الموافقة على طلب إعادة الفتح. الطلب نشط من جديد.",
    ctaLabelEn: "Open request",
    ctaLabelAr: "فتح الطلب",
  },
  REOPEN_DECIDED_REJECTED: {
    titleEn: "Reopen declined",
    titleAr: "تم رفض إعادة الفتح",
    bodyEn: "{requestNo}: Your reopen request was declined. {reason}",
    bodyAr: "{requestNo}: تم رفض طلب إعادة الفتح. {reason}",
    ctaLabelEn: "Open request",
    ctaLabelAr: "فتح الطلب",
  },
};

function interpolate(
  template: string,
  vars: NotificationCopyVars,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key as keyof NotificationCopyVars];
    return value ?? "";
  });
}

/**
 * Bilingual `RequestState` labels — mirrors `messages/{en,ar}.json`'s
 * `states.*` namespace. Duplicated by necessity, same as the rest of this
 * file: `notify()` runs inside a DB transaction with no per-recipient locale
 * yet (that's resolved later, per-user, in the outbox worker), so it can't
 * go through next-intl's request-scoped `useTranslations`. Used by `notify()`
 * to populate `stateLabelEn`/`stateLabelAr` on the outbox payload so emails
 * show a real label instead of the raw state enum.
 */
const REQUEST_STATE_LABELS: Record<string, { en: string; ar: string }> = {
  DRAFT: { en: "Draft", ar: "مسودة" },
  SUBMITTED: { en: "Submitted", ar: "مُقدَّم" },
  UNDER_INTAKE_REVIEW: { en: "Under intake review", ar: "مراجعة الاستلام" },
  RETURNED_TO_CLIENT: { en: "Returned to client", ar: "مُعاد للعميل" },
  ACCEPTED: { en: "Accepted", ar: "مقبول" },
  ASSESSMENT_QUEUED: { en: "Assessment queued", ar: "بانتظار التقييم" },
  ASSESSMENT_RUNNING: { en: "Assessment running", ar: "التقييم جارٍ" },
  TECHNICAL_REVIEW: { en: "Technical review", ar: "المراجعة الفنية" },
  DECISION: { en: "Decision", ar: "القرار" },
  REPORT_ISSUED: { en: "Report issued", ar: "صدر التقرير" },
  CLOSED: { en: "Done", ar: "تم" },
  CANCELLED: { en: "Cancelled", ar: "ملغى" },
  ON_HOLD: { en: "On hold", ar: "معلّق" },
};

/** Bilingual label for a `RequestState`, or null for an unrecognized value. */
export function requestStateLabel(
  state: string,
): { en: string; ar: string } | null {
  return REQUEST_STATE_LABELS[state] ?? null;
}

/** Resolve bilingual title/body/CTA for a notification event. */
export function notificationCopy(
  key: NotificationCopyKey,
  vars: NotificationCopyVars = {},
): NotificationCopy {
  const raw = CATALOG[key];
  return {
    titleEn: interpolate(raw.titleEn, vars),
    titleAr: interpolate(raw.titleAr, vars),
    bodyEn: interpolate(raw.bodyEn, vars),
    bodyAr: interpolate(raw.bodyAr, vars),
    ...(raw.ctaLabelEn !== undefined
      ? { ctaLabelEn: raw.ctaLabelEn, ctaLabelAr: raw.ctaLabelAr }
      : {}),
  };
}
