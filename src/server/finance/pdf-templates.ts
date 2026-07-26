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
    <div><span>${input.locale === "ar" ? "الفرعي" : "Subtotal"}</span><span class="mono">SAR ${money(input.subtotal)}</span></div>
    <div><span>${input.locale === "ar" ? "الخصم" : "Discount"}</span><span class="mono">SAR ${money(input.discount)}</span></div>
    <div><span>${input.locale === "ar" ? "الضريبة" : "VAT"}</span><span class="mono">SAR ${money(input.vatAmount)}</span></div>
    <div><strong>${input.locale === "ar" ? "الإجمالي" : "Total"}</strong><strong class="mono">SAR ${money(input.total)}</strong></div>
  </div>
</body>
</html>`;

  return htmlToPdf(html);
}

export type ReportPdfInput = {
  locale: "ar" | "en";
  requestNo: string;
  organisationName: string;
  productName: string;
  serviceName: string;
  issuedAt: string;
  state: string;
};

export async function renderReportPdf(
  input: ReportPdfInput,
): Promise<Buffer> {
  const dir = input.locale === "ar" ? "rtl" : "ltr";
  const fontStack =
    input.locale === "ar"
      ? "'Atlas Arabic', Montserrat, Arial, sans-serif"
      : "Montserrat, Arial, sans-serif";
  const title =
    input.locale === "ar"
      ? "شهادة / تقرير المطابقة"
      : "Certificate of Conformity report";
  const fonts = await embeddedFontCss();

  const html = `<!DOCTYPE html>
<html lang="${input.locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<style>
${fonts}
body{font-family:${fontStack};color:#1C2229;margin:0}
h1{color:#519E53;font-size:22px;margin:0 0 8px}
.mono{font-family:'IBM Plex Mono',monospace;direction:ltr}
.card{border:1px solid #DDDDDD;border-radius:8px;padding:16px;margin-top:20px}
.label{font-size:12px;color:#4D4D4D;margin-bottom:4px}
.value{font-size:15px;font-weight:600}
.footer{margin-top:28px;font-size:12px;color:#4D4D4D}
</style>
</head>
<body>
  <h1>Atlas COC · ${esc(title)}</h1>
  <p class="mono">${esc(input.requestNo)}</p>
  <div class="card">
    <div class="label">${input.locale === "ar" ? "الشركة" : "Organisation"}</div>
    <div class="value">${esc(input.organisationName)}</div>
  </div>
  <div class="card">
    <div class="label">${input.locale === "ar" ? "المنتج" : "Product"}</div>
    <div class="value">${esc(input.productName)}</div>
  </div>
  <div class="card">
    <div class="label">${input.locale === "ar" ? "الخدمة" : "Service"}</div>
    <div class="value">${esc(input.serviceName)}</div>
  </div>
  <div class="card">
    <div class="label">${input.locale === "ar" ? "تاريخ الإصدار" : "Issued"}</div>
    <div class="value mono">${esc(input.issuedAt)}</div>
  </div>
  <div class="card">
    <div class="label">${input.locale === "ar" ? "الحالة" : "Status"}</div>
    <div class="value">${esc(input.state)}</div>
  </div>
  <p class="footer">
    ${
      input.locale === "ar"
        ? "مستند توضيحي للمرحلة الأولى — تحقق من الرقم عبر بوابة التحقق العامة."
        : "Phase-1 summary report — verify the request number on the public verify portal."
    }
  </p>
</body>
</html>`;

  return htmlToPdf(html);
}
