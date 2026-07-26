import * as React from "react";
import { AtlasEmailShell } from "@/emails/atlas-email-shell";
import type { NotificationEventType } from "@/lib/notification-events";

export type EmailTemplatePayload = {
  requestNo?: string | null;
  state?: string | null;
  link: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  ctaLabelEn?: string;
  ctaLabelAr?: string;
  stateLabelEn?: string;
  stateLabelAr?: string;
};

function appUrl(): string {
  return (
    process.env.AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function buildCtaUrl(locale: "ar" | "en", link: string): string {
  const path = link.startsWith("/") ? link : `/${link}`;
  return `${appUrl()}/${locale}${path}`;
}

export function renderEventEmailElement(
  event: NotificationEventType,
  locale: "ar" | "en",
  payload: EmailTemplatePayload,
): React.ReactElement {
  const title = locale === "ar" ? payload.titleAr : payload.titleEn;
  const body = locale === "ar" ? payload.bodyAr : payload.bodyEn;
  const ctaLabel =
    locale === "ar"
      ? (payload.ctaLabelAr ?? "فتح الطلب")
      : (payload.ctaLabelEn ?? "Open request");
  const stateLabel =
    locale === "ar"
      ? (payload.stateLabelAr ?? payload.state ?? null)
      : (payload.stateLabelEn ?? payload.state ?? null);

  return (
    <AtlasEmailShell
      locale={locale}
      preview={title}
      title={title}
      requestNo={payload.requestNo}
      stateLabel={stateLabel}
      body={body}
      ctaUrl={buildCtaUrl(locale, payload.link)}
      ctaLabel={ctaLabel}
    />
  );
}

export function renderPlainText(
  locale: "ar" | "en",
  payload: EmailTemplatePayload,
): string {
  const title = locale === "ar" ? payload.titleAr : payload.titleEn;
  const body = locale === "ar" ? payload.bodyAr : payload.bodyEn;
  const ctaLabel =
    locale === "ar"
      ? (payload.ctaLabelAr ?? "فتح الطلب")
      : (payload.ctaLabelEn ?? "Open request");
  const lines = [
    title,
    "",
    payload.requestNo ? String(payload.requestNo) : "",
    payload.state ? String(payload.state) : "",
    "",
    body,
    "",
    `${ctaLabel}: ${buildCtaUrl(locale, payload.link)}`,
    "",
    "Atlas Support & Services",
  ].filter((line, i, arr) => !(line === "" && arr[i - 1] === ""));
  return lines.join("\n");
}

/** Subject line per event — keep short for Outlook. */
export function emailSubject(
  event: NotificationEventType,
  locale: "ar" | "en",
  payload: EmailTemplatePayload,
): string {
  const no = payload.requestNo ? ` · ${payload.requestNo}` : "";
  if (locale === "ar") {
    switch (event) {
      case "REQUEST_SUBMITTED":
        return `طلب جديد${no}`;
      case "REQUEST_RECEIVED":
        return `تأكيد استلام طلبكم${no}`;
      case "REQUEST_RESUBMITTED":
        return `إعادة تقديم${no}`;
      case "REQUEST_RETURNED":
        return `إعادة الطلب للعميل${no}`;
      case "REQUEST_ACCEPTED":
        return `قبول الطلب${no}`;
      case "REQUEST_ASSIGNED":
        return `تعيين طلب${no}`;
      case "REPORT_ISSUED":
        return `إصدار التقرير${no}`;
      case "INVOICE_ISSUED":
        return `إصدار فاتورة مبدئية${no}`;
      case "PAYMENT_RECEIVED":
        return `استلام دفعة${no}`;
      case "PAYMENT_REJECTED":
        return `رفض دفعة${no}`;
      case "SLA_AT_RISK":
        return `تنبيه مستوى الخدمة${no}`;
      case "SLA_BREACHED":
        return `تجاوز مستوى الخدمة${no}`;
      case "COMMENT_ADDED":
        return `تعليق جديد${no}`;
      default:
        return `${payload.titleAr}${no}`;
    }
  }
  switch (event) {
    case "REQUEST_SUBMITTED":
      return `New request${no}`;
    case "REQUEST_RECEIVED":
      return `We've received your request${no}`;
    case "REQUEST_RESUBMITTED":
      return `Resubmitted${no}`;
    case "REQUEST_RETURNED":
      return `Returned to client${no}`;
    case "REQUEST_ACCEPTED":
      return `Request accepted${no}`;
    case "REQUEST_ASSIGNED":
      return `Request assigned${no}`;
    case "REPORT_ISSUED":
      return `Report issued${no}`;
    case "INVOICE_ISSUED":
      return `Pro forma invoice issued${no}`;
    case "PAYMENT_RECEIVED":
      return `Payment received${no}`;
    case "PAYMENT_REJECTED":
      return `Payment rejected${no}`;
    case "SLA_AT_RISK":
      return `SLA at risk${no}`;
    case "SLA_BREACHED":
      return `SLA breached${no}`;
    case "COMMENT_ADDED":
      return `New comment${no}`;
    default:
      return `${payload.titleEn}${no}`;
  }
}
