/**
 * Bilingual notification copy for in-app + email (server-side; no next-intl).
 * Template vars use `{name}` placeholders.
 */

export type NotificationCopyKey =
  | "REQUEST_SUBMITTED"
  | "REQUEST_RESUBMITTED"
  | "REQUEST_RETURNED"
  | "REQUEST_ACCEPTED"
  | "REQUEST_ASSIGNED"
  | "REPORT_ISSUED"
  | "INVOICE_ISSUED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_REJECTED"
  | "SLA_AT_RISK"
  | "SLA_BREACHED"
  | "COMMENT_ADDED_FROM_CLIENT"
  | "COMMENT_ADDED_FROM_ATLAS"
  | "CREDIT_LIMIT"
  | "STATEMENT_OVERDUE";

export type NotificationCopyVars = {
  requestNo?: string;
  invoiceNo?: string;
  amount?: string;
  reason?: string;
  message?: string;
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
    bodyEn: "{requestNo} awaits intake review.",
    bodyAr: "{requestNo} بانتظار مراجعة الاستلام.",
    ctaLabelEn: "Open in intake",
    ctaLabelAr: "فتح في الاستلام",
  },
  REQUEST_RESUBMITTED: {
    titleEn: "Request resubmitted",
    titleAr: "أُعيد تقديم الطلب",
    bodyEn: "{requestNo} was resubmitted after client corrections.",
    bodyAr: "أُعيد تقديم {requestNo} بعد تصحيحات العميل.",
    ctaLabelEn: "Open in intake",
    ctaLabelAr: "فتح في الاستلام",
  },
  REQUEST_RETURNED: {
    titleEn: "Request returned",
    titleAr: "تم إرجاع الطلب",
    bodyEn: "{requestNo}: Your request was returned for corrections.",
    bodyAr: "{requestNo}: تم إرجاع طلبك لإجراء تصحيحات.",
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
    bodyEn: "{requestNo} was assigned to you.",
    bodyAr: "تم تعيين {requestNo} لك.",
    ctaLabelEn: "Open queue item",
    ctaLabelAr: "فتح عنصر الطابور",
  },
  REPORT_ISSUED: {
    titleEn: "Report issued",
    titleAr: "تم إصدار التقرير",
    bodyEn: "{requestNo}: Your certificate of conformity report is ready.",
    bodyAr: "{requestNo}: تقرير شهادة المطابقة جاهز الآن.",
  },
  INVOICE_ISSUED: {
    titleEn: "Invoice issued",
    titleAr: "إصدار فاتورة",
    bodyEn: "Invoice {invoiceNo} for {requestNo} — SAR {amount}.",
    bodyAr: "فاتورة {invoiceNo} للطلب {requestNo} — {amount} ر.س.",
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
    bodyEn: "Invoice {invoiceNo} is past due (open balance SAR {amount}).",
    bodyAr: "الفاتورة {invoiceNo} متأخرة (الرصيد المفتوح {amount} ر.س).",
    ctaLabelEn: "View statement",
    ctaLabelAr: "عرض كشف الحساب",
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
