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
  | "REPORT_ISSUED"
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
