import { embeddedFontCss, htmlToPdf } from "@/server/finance/pdf";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(n: number): string {
  return new Intl.NumberFormat("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export type StatementPdfInput = {
  locale: "ar" | "en";
  organisationName: string;
  generatedAt: string;
  balance: number;
  rows: Array<{
    date: string;
    description: string;
    reference: string;
    debit: number;
    credit: number;
    running: number;
  }>;
};

export async function renderStatementPdf(
  input: StatementPdfInput,
): Promise<Buffer> {
  const dir = input.locale === "ar" ? "rtl" : "ltr";
  const fontStack =
    input.locale === "ar"
      ? "'Atlas Arabic', Montserrat, Arial, sans-serif"
      : "Montserrat, Arial, sans-serif";
  const title =
    input.locale === "ar" ? "كشف حساب" : "Account statement";
  const balLabel =
    input.balance > 0
      ? input.locale === "ar"
        ? "المبلغ المستحق"
        : "You owe"
      : input.balance < 0
        ? input.locale === "ar"
          ? "رصيد دائن"
          : "In credit"
        : input.locale === "ar"
          ? "الرصيد"
          : "Balance";

  const fonts = await embeddedFontCss();
  const bodyRows = input.rows
    .map(
      (r) => `<tr>
      <td>${esc(r.date)}</td>
      <td>${esc(r.description)}</td>
      <td class="mono">${esc(r.reference)}</td>
      <td class="mono num">${r.debit ? money(r.debit) : "—"}</td>
      <td class="mono num">${r.credit ? money(r.credit) : "—"}</td>
      <td class="mono num">${money(r.running)}</td>
    </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="${input.locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<style>
${fonts}
body{font-family:${fontStack};color:#1C2229;font-size:11px;margin:0}
h1{font-size:18px;margin:0 0 4px;color:#519E53}
.meta{color:#4D4D4D;margin-bottom:16px}
.bal{font-family:'IBM Plex Mono',monospace;font-size:16px;margin:8px 0 20px}
table{width:100%;border-collapse:collapse}
th,td{border-bottom:1px solid #DDDDDD;padding:6px 4px;text-align:${dir === "rtl" ? "right" : "left"}}
th{font-size:10px;color:#4D4D4D;font-weight:600}
.mono{font-family:'IBM Plex Mono',monospace}
.num{direction:ltr;unicode-bidi:embed;text-align:right}
</style>
</head>
<body>
  <h1>Atlas COC · ${esc(title)}</h1>
  <div class="meta">${esc(input.organisationName)} · ${esc(input.generatedAt)}</div>
  <div class="bal">${esc(balLabel)}: SAR ${money(Math.abs(input.balance))}</div>
  <table>
    <thead>
      <tr>
        <th>${input.locale === "ar" ? "التاريخ" : "Date"}</th>
        <th>${input.locale === "ar" ? "الوصف" : "Description"}</th>
        <th>${input.locale === "ar" ? "المرجع" : "Reference"}</th>
        <th>${input.locale === "ar" ? "مدين" : "Debit"}</th>
        <th>${input.locale === "ar" ? "دائن" : "Credit"}</th>
        <th>${input.locale === "ar" ? "الرصيد" : "Balance"}</th>
      </tr>
    </thead>
    <tbody>${bodyRows || `<tr><td colspan="6">${input.locale === "ar" ? "لا قيود" : "No entries"}</td></tr>`}</tbody>
  </table>
</body>
</html>`;

  return htmlToPdf(html);
}

export type InvoicePdfInput = {
  locale: "ar" | "en";
  invoiceNo: string;
  organisationName: string;
  status: string;
  issuedAt: string;
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
  lines: Array<{ description: string; qty: number; unitPrice: number; lineTotal: number }>;
};

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const dir = input.locale === "ar" ? "rtl" : "ltr";
  const fontStack =
    input.locale === "ar"
      ? "'Atlas Arabic', Montserrat, Arial, sans-serif"
      : "Montserrat, Arial, sans-serif";
  const fonts = await embeddedFontCss();
  const lines = input.lines
    .map(
      (l) => `<tr>
      <td>${esc(l.description)}</td>
      <td class="mono num">${l.qty}</td>
      <td class="mono num">${money(l.unitPrice)}</td>
      <td class="mono num">${money(l.lineTotal)}</td>
    </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="${input.locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<style>
${fonts}
body{font-family:${fontStack};color:#1C2229;font-size:11px}
h1{color:#519E53;font-size:18px}
.mono{font-family:'IBM Plex Mono',monospace}
.num{direction:ltr;text-align:right}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border-bottom:1px solid #DDDDDD;padding:6px 4px;text-align:${dir === "rtl" ? "right" : "left"}}
.totals{margin-top:16px;width:240px;${dir === "rtl" ? "margin-right:auto" : "margin-left:auto"}}
.totals div{display:flex;justify-content:space-between;padding:3px 0}
</style>
</head>
<body>
  <h1>Atlas COC · ${input.locale === "ar" ? "فاتورة مبدئية" : "Pro Forma Invoice"} ${esc(input.invoiceNo)}</h1>
  <p>${esc(input.organisationName)}</p>
  <p class="mono">${esc(input.status)} · ${esc(input.issuedAt)}</p>
  <table>
    <thead>
      <tr>
        <th>${input.locale === "ar" ? "البند" : "Line"}</th>
        <th>${input.locale === "ar" ? "الكمية" : "Qty"}</th>
        <th>${input.locale === "ar" ? "السعر" : "Unit"}</th>
        <th>${input.locale === "ar" ? "الإجمالي" : "Total"}</th>
      </tr>
    </thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="totals">
    <div><span>${input.locale === "ar" ? "المجموع الفرعي" : "Subtotal"}</span><span class="mono">SAR ${money(input.subtotal)}</span></div>
    <div><span>${input.locale === "ar" ? "الخصم" : "Discount"}</span><span class="mono">SAR ${money(input.discount)}</span></div>
    <div><span>${input.locale === "ar" ? "الضريبة" : "VAT"}</span><span class="mono">SAR ${money(input.vatAmount)}</span></div>
    <div><strong>${input.locale === "ar" ? "الإجمالي" : "Total"}</strong><strong class="mono">SAR ${money(input.total)}</strong></div>
  </div>
</body>
</html>`;

  return htmlToPdf(html);
}

/**
 * Shipment Conformity Certificate for Imported Products (SCOC, SAB-002) —
 * mirrors the layout of the SABER-issued certificate Atlas obtains as the
 * accredited CB, so the platform can generate/preview a matching document
 * from request data rather than only accepting an uploaded scan (see
 * ExternalDeliverablePanel). Fields with no source yet on the SCOC intake
 * form (trade mark, product description, production date, exporter address)
 * render as "—" until the form captures them.
 */
export type ScocCertificatePdfInput = {
  locale: "ar" | "en";
  certificateNumber: string;
  issueDate: string;
  expirationDate: string;
  establishmentAddress: string;
  shipmentCountry: string;
  brandName: string;
  tradeMark: string;
  productName: string;
  productDescription: string;
  countryOfOrigin: string;
  productionDate: string;
  hsCode: string;
  technicalRegulation: string;
  manufacturerName: string;
  exporterAddress: string;
  generatedAt: string;
};

export async function renderScocCertificatePdf(
  input: ScocCertificatePdfInput,
): Promise<Buffer> {
  const dir = input.locale === "ar" ? "rtl" : "ltr";
  const fontStack =
    input.locale === "ar"
      ? "'Atlas Arabic', Montserrat, Arial, sans-serif"
      : "Montserrat, Arial, sans-serif";
  const fonts = await embeddedFontCss();
  const dash = "—";
  const v = (s: string) => esc(s.trim() || dash);

  const L =
    input.locale === "ar"
      ? {
          titleAr: "شهادة مطابقة إرسالية للمنتجات المستوردة",
          titleEn: "Shipment Conformity Certificate for Imported Products",
          certNo: "رقم الشهادة",
          issueDate: "تاريخ الإصدار",
          expiryDate: "تاريخ الانتهاء",
          establishmentAddress: "عنوان المنشأة",
          shipmentCountry: "بلد الشحن",
          sectionTitle: "بيانات المنتج والمصنّع",
          brandName: "الاسم التجاري",
          tradeMark: "العلامة التجارية",
          productName: "اسم المنتج",
          productDescription: "وصف المنتج",
          countryOfOrigin: "بلد المنشأ",
          productionDate: "تاريخ الإنتاج",
          hsCode: "الرمز الجمركي",
          technicalRegulation: "اللائحة الفنية",
          manufacturerName: "اسم الشركة المصنعة",
          exporterAddress: "عنوان المصدّر",
          signatureBox: "توقيع مسؤول جهة التقييم",
          stampBox: "ختم جهة التقييم",
        }
      : {
          titleAr: "شهادة مطابقة إرسالية للمنتجات المستوردة",
          titleEn: "Shipment Conformity Certificate for Imported Products",
          certNo: "Certificate Number",
          issueDate: "Issue Date",
          expiryDate: "Expiration Date",
          establishmentAddress: "Establishment Address",
          shipmentCountry: "Shipment Country",
          sectionTitle: "Product and Manufacturer Data",
          brandName: "Brand Name",
          tradeMark: "Trade Mark",
          productName: "Product Name",
          productDescription: "Product Description",
          countryOfOrigin: "Country of origin",
          productionDate: "Production Date",
          hsCode: "HS Code",
          technicalRegulation: "Technical Regulation",
          manufacturerName: "Manufacturer Name",
          exporterAddress: "Exporter Address",
          signatureBox: "CB Organisation Office Responsible Signature",
          stampBox: "CB Organisation Office Stamp",
        };

  const html = `<!DOCTYPE html>
<html lang="${input.locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<style>
${fonts}
*{box-sizing:border-box}
body{font-family:${fontStack};color:#1C2229;margin:0;font-size:11px;background:#fff}
.sheet{position:relative;border:1.5px solid #519E53;border-radius:10px;padding:18px 22px;overflow:hidden}
.watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform:rotate(-28deg);font-size:64px;font-weight:700;color:#519E53;opacity:0.06;letter-spacing:4px;pointer-events:none;white-space:nowrap}
.header{position:relative;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #519E53;padding-bottom:10px;margin-bottom:12px}
.brand{font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:13px;color:#519E53}
.brand-ar{font-family:'Atlas Arabic',sans-serif;font-size:11px;color:#4D4D4D}
.title{text-align:center;flex:1}
.title-ar{font-family:'Atlas Arabic',sans-serif;font-size:15px;font-weight:700;margin:0 0 2px}
.title-en{font-size:11px;color:#4D4D4D;margin:0}
.spacer{width:70px}
.grid{position:relative;display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #DDDDDD;border-radius:6px;margin-bottom:10px}
.grid.cols-2{grid-template-columns:repeat(2,1fr)}
.cell{padding:7px 10px;border-${dir === "rtl" ? "left" : "right"}:1px solid #DDDDDD}
.cell:last-child{border-${dir === "rtl" ? "left" : "right"}:none}
.label{font-size:9px;color:#4D4D4D;margin-bottom:3px}
.value{font-size:12px;font-weight:600}
.value.mono{font-family:'IBM Plex Mono',monospace;direction:ltr;unicode-bidi:embed;text-align:${dir === "rtl" ? "right" : "left"}}
.section-bar{position:relative;background:#519E53;color:#fff;border-radius:6px;padding:7px 12px;font-size:12px;font-weight:700;margin-bottom:10px}
.footer{position:relative;display:flex;gap:16px;margin-top:18px}
.box{flex:1;border:1px dashed #B9B9B9;border-radius:6px;min-height:70px;padding:8px 10px;display:flex;flex-direction:column;justify-content:flex-end}
.box .label{margin-bottom:0}
.timestamp{position:relative;margin-top:12px;text-align:${dir === "rtl" ? "left" : "right"};font-family:'IBM Plex Mono',monospace;font-size:9px;color:#8A8A8A}
</style>
</head>
<body>
  <div class="sheet">
    <div class="watermark">ATLAS &nbsp; أطلس</div>
    <div class="header">
      <div class="spacer"></div>
      <div class="title">
        <p class="title-ar">${esc(L.titleAr)}</p>
        <p class="title-en">${esc(L.titleEn)}</p>
      </div>
      <div class="spacer" style="text-align:${dir === "rtl" ? "left" : "right"}">
        <div class="brand">ATLAS</div>
        <div class="brand-ar">أطلس للمساندة والخدمات</div>
      </div>
    </div>

    <div class="grid">
      <div class="cell">
        <div class="label">${esc(L.certNo)}</div>
        <div class="value mono">${v(input.certificateNumber)}</div>
      </div>
      <div class="cell">
        <div class="label">${esc(L.issueDate)}</div>
        <div class="value mono">${v(input.issueDate)}</div>
      </div>
      <div class="cell">
        <div class="label">${esc(L.expiryDate)}</div>
        <div class="value mono">${v(input.expirationDate)}</div>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="cell">
        <div class="label">${esc(L.establishmentAddress)}</div>
        <div class="value">${v(input.establishmentAddress)}</div>
      </div>
      <div class="cell">
        <div class="label">${esc(L.shipmentCountry)}</div>
        <div class="value">${v(input.shipmentCountry)}</div>
      </div>
    </div>

    <div class="section-bar">${esc(L.sectionTitle)}</div>

    <div class="grid cols-2">
      <div class="cell">
        <div class="label">${esc(L.brandName)}</div>
        <div class="value">${v(input.brandName)}</div>
      </div>
      <div class="cell">
        <div class="label">${esc(L.tradeMark)}</div>
        <div class="value">${v(input.tradeMark)}</div>
      </div>
      <div class="cell" style="grid-column:1/-1">
        <div class="label">${esc(L.productName)}</div>
        <div class="value">${v(input.productName)}</div>
      </div>
      <div class="cell" style="grid-column:1/-1">
        <div class="label">${esc(L.productDescription)}</div>
        <div class="value">${v(input.productDescription)}</div>
      </div>
      <div class="cell">
        <div class="label">${esc(L.countryOfOrigin)}</div>
        <div class="value">${v(input.countryOfOrigin)}</div>
      </div>
      <div class="cell">
        <div class="label">${esc(L.productionDate)}</div>
        <div class="value mono">${v(input.productionDate)}</div>
      </div>
      <div class="cell" style="grid-column:1/-1">
        <div class="label">${esc(L.hsCode)}</div>
        <div class="value mono">${v(input.hsCode)}</div>
      </div>
      <div class="cell" style="grid-column:1/-1">
        <div class="label">${esc(L.technicalRegulation)}</div>
        <div class="value">${v(input.technicalRegulation)}</div>
      </div>
      <div class="cell">
        <div class="label">${esc(L.manufacturerName)}</div>
        <div class="value">${v(input.manufacturerName)}</div>
      </div>
      <div class="cell">
        <div class="label">${esc(L.exporterAddress)}</div>
        <div class="value">${v(input.exporterAddress)}</div>
      </div>
    </div>

    <div class="footer">
      <div class="box"><div class="label">${esc(L.signatureBox)}</div></div>
      <div class="box"><div class="label">${esc(L.stampBox)}</div></div>
    </div>

    <div class="timestamp">${esc(input.generatedAt)}</div>
  </div>
</body>
</html>`;

  return htmlToPdf(html);
}

export type ReportPdfDecision =
  | "ACCEPTED"
  | "ACCEPTED_WITH_REMARKS"
  | "REJECTED"
  | "INCOMPLETE"
  | null;

export type ReportPdfItem = {
  productName: string;
  serviceName: string;
  technicalRegulation: string | null;
  checklistCompliant: number | null;
  checklistTotal: number | null;
  decision: ReportPdfDecision;
};

export type ReportPdfInput = {
  locale: "ar" | "en";
  requestNo: string;
  organisationName: string;
  issuedAt: string;
  state: string;
  items: ReportPdfItem[];
  technicalReviewSummary: {
    compliant: number;
    total: number;
    decision: ReportPdfDecision;
  } | null;
  evaluatorName: string | null;
  reviewerName: string | null;
  decisionMakerName: string | null;
  generatedAt: string;
};

const DECISION_LABELS: Record<
  NonNullable<ReportPdfDecision>,
  { en: string; ar: string }
> = {
  ACCEPTED: { en: "Accepted", ar: "مقبول" },
  ACCEPTED_WITH_REMARKS: {
    en: "Accepted with remarks",
    ar: "مقبول مع ملاحظات",
  },
  REJECTED: { en: "Rejected", ar: "مرفوض" },
  INCOMPLETE: { en: "Incomplete", ar: "غير مكتمل" },
};

function decisionLabel(
  decision: ReportPdfDecision,
  locale: "ar" | "en",
): string {
  if (!decision) return locale === "ar" ? "غير متاح" : "Not available";
  const entry = DECISION_LABELS[decision];
  return locale === "ar" ? entry.ar : entry.en;
}

export async function renderReportPdf(
  input: ReportPdfInput,
): Promise<Buffer> {
  const dir = input.locale === "ar" ? "rtl" : "ltr";
  const isAr = input.locale === "ar";
  const fontStack = isAr
    ? "'Atlas Arabic', Montserrat, Arial, sans-serif"
    : "Montserrat, Arial, sans-serif";
  const title = isAr
    ? "شهادة / تقرير المطابقة"
    : "Certificate of Conformity report";
  const fonts = await embeddedFontCss();

  const itemRows = input.items
    .map((item) => {
      const checklistLine =
        item.checklistTotal !== null
          ? `${esc(String(item.checklistCompliant ?? 0))} / ${esc(
              String(item.checklistTotal),
            )} ${isAr ? "بند مطابق" : "items compliant"}`
          : isAr
            ? "لا يوجد قائمة تحقق"
            : "No checklist recorded";
      return `<div class="card">
        <div class="value">${esc(item.productName)} <span class="muted">· ${esc(item.serviceName)}</span></div>
        ${
          item.technicalRegulation
            ? `<div class="row"><span class="label">${isAr ? "اللائحة الفنية" : "Technical regulation"}</span><span>${esc(item.technicalRegulation)}</span></div>`
            : ""
        }
        <div class="row"><span class="label">${isAr ? "نتيجة قائمة التحقق" : "Checklist result"}</span><span>${checklistLine}</span></div>
        <div class="row"><span class="label">${isAr ? "نتيجة المطابقة" : "Conformity conclusion"}</span><span class="decision decision-${(item.decision ?? "none").toLowerCase()}">${esc(decisionLabel(item.decision, input.locale))}</span></div>
      </div>`;
    })
    .join("\n");

  const technicalReviewBlock = input.technicalReviewSummary
    ? `<div class="card">
        <div class="label">${isAr ? "المراجعة الفنية" : "Technical review"}</div>
        <div class="row"><span>${isAr ? "قائمة المراجعة" : "Review checklist"}</span><span>${esc(String(input.technicalReviewSummary.compliant))} / ${esc(String(input.technicalReviewSummary.total))}</span></div>
        <div class="row"><span>${isAr ? "التوصية" : "Recommendation"}</span><span class="decision decision-${(input.technicalReviewSummary.decision ?? "none").toLowerCase()}">${esc(decisionLabel(input.technicalReviewSummary.decision, input.locale))}</span></div>
      </div>`
    : "";

  const signOff = [
    { role: isAr ? "المقيّم" : "Evaluator", name: input.evaluatorName },
    { role: isAr ? "المراجع الفني" : "Technical reviewer", name: input.reviewerName },
    { role: isAr ? "متخذ القرار" : "Decision maker", name: input.decisionMakerName },
  ];

  const html = `<!DOCTYPE html>
<html lang="${input.locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<style>
${fonts}
body{font-family:${fontStack};color:#1C2229;margin:0;padding:32px}
h1{color:#519E53;font-size:22px;margin:0 0 8px}
.mono{font-family:'IBM Plex Mono',monospace;direction:ltr}
.card{border:1px solid #DDDDDD;border-radius:8px;padding:16px;margin-top:16px}
.label{font-size:12px;color:#4D4D4D;margin-bottom:4px}
.value{font-size:15px;font-weight:600}
.muted{font-size:12px;color:#4D4D4D;font-weight:400}
.row{display:flex;justify-content:space-between;font-size:13px;margin-top:6px}
.decision{font-weight:600}
.decision-accepted{color:#2E7048}
.decision-accepted_with_remarks{color:#96601A}
.decision-rejected{color:#A83A2C}
.decision-incomplete,.decision-none{color:#6B756B}
.section-title{font-size:14px;font-weight:700;margin-top:24px}
.footer{margin-top:28px;font-size:12px;color:#4D4D4D}
.signoff{display:flex;gap:16px;margin-top:16px}
.signoff .box{flex:1;border-top:1px solid #999;padding-top:6px;font-size:12px}
.timestamp{margin-top:12px;font-size:11px;color:#8A8A8A}
</style>
</head>
<body>
  <h1>Atlas COC · ${esc(title)}</h1>
  <p class="mono">${esc(input.requestNo)}</p>
  <div class="card">
    <div class="row"><span class="label">${isAr ? "الشركة" : "Organisation"}</span><span class="value">${esc(input.organisationName)}</span></div>
    <div class="row"><span class="label">${isAr ? "تاريخ الإصدار" : "Issued"}</span><span class="value mono">${esc(input.issuedAt)}</span></div>
    <div class="row"><span class="label">${isAr ? "الحالة" : "Status"}</span><span class="value">${esc(input.state)}</span></div>
  </div>

  <div class="section-title">${isAr ? "المنتجات والخدمات" : "Products and services assessed"}</div>
  ${itemRows}

  ${technicalReviewBlock}

  <div class="section-title">${isAr ? "الاعتماد" : "Sign-off"}</div>
  <div class="signoff">
    ${signOff
      .map(
        (s) =>
          `<div class="box"><div class="label">${esc(s.role)}</div><div>${esc(s.name ?? (isAr ? "غير مسجل" : "Not recorded"))}</div></div>`,
      )
      .join("\n")}
  </div>

  <p class="footer">
    ${
      isAr
        ? "للتحقق من صحة هذا التقرير، يرجى إدخال رقم الطلب في بوابة التحقق العامة."
        : "To verify this report, enter the request number on the public verify portal."
    }
  </p>
  <div class="timestamp">${esc(input.generatedAt)}</div>
</body>
</html>`;

  return htmlToPdf(html);
}
