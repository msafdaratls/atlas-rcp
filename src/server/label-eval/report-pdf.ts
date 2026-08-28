import { embeddedFontCss, htmlToPdf } from "@/server/finance/pdf";
import type { AssessmentDetail } from "@/server/label-eval/queries";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Palette matches the report-engine mockup shared with the client: warm
// paper ground, deep-green accent, semantic pass/warn/fail tones — not the
// finance templates' Atlas-green-on-white look. Keep these two systems
// visually distinct; this one is intentionally document-styled.
const PAPER = "#FAF7F0";
const PAPER_RAISED = "#FFFFFF";
const INK = "#1C1F1A";
const INK_SOFT = "#5A5F52";
const LINE = "#DDD6C4";
const LINE_STRONG = "#C8BF9F";
const ACCENT = "#0F5132";
const ACCENT_SOFT = "#E3EDE4";
const CHIP_BG = "#F1EDE1";
const GOOD = "#1E7D3C";
const GOOD_BG = "#E7F3E9";
const WARN = "#A5680C";
const WARN_BG = "#FBF0DD";
const BAD = "#B3301F";
const BAD_BG = "#FAEAE7";

const VERDICT_TONE: Record<string, { bg: string; fg: string; icon: string }> = {
  COMPLIANT: { bg: GOOD_BG, fg: GOOD, icon: "check" },
  NON_COMPLIANT: { bg: BAD_BG, fg: BAD, icon: "cross" },
  NA: { bg: CHIP_BG, fg: INK_SOFT, icon: "dash" },
  NEEDS_REVIEW: { bg: WARN_BG, fg: WARN, icon: "bang" },
  REQUIRES_ADDITIONAL_DATA: { bg: WARN_BG, fg: WARN, icon: "bang" },
  MISSING: { bg: BAD_BG, fg: BAD, icon: "cross" },
};

const VERDICT_ICON: Record<string, string> = { check: "✓", cross: "✕", bang: "!", dash: "–" };

const FINDING_VERDICTS = new Set(["NON_COMPLIANT", "MISSING", "REQUIRES_ADDITIONAL_DATA"]);

const VERDICT_LABEL: Record<string, { en: string; ar: string }> = {
  COMPLIANT: { en: "Pass", ar: "مطابق" },
  NON_COMPLIANT: { en: "Fail", ar: "غير مطابق" },
  NA: { en: "N/A", ar: "لا ينطبق" },
  NEEDS_REVIEW: { en: "Review", ar: "يتطلب مراجعة" },
  REQUIRES_ADDITIONAL_DATA: { en: "Review", ar: "يتطلب بيانات" },
  MISSING: { en: "Fail", ar: "مفقود" },
};

const FINAL_VERDICT_LABEL: Record<string, { en: string; ar: string }> = {
  accepted: { en: "Compliant — Approved", ar: "مطابق — معتمد" },
  accepted_with_remarks: { en: "Conditional — Action Required", ar: "مشروط — يتطلب إجراء" },
  rejected: { en: "Non-compliant — Rejected", ar: "غير مطابق — مرفوض" },
  incomplete: { en: "Incomplete — Pending Review", ar: "غير مكتمل — بانتظار المراجعة" },
  compliant: { en: "Compliant — Approved", ar: "مطابق — معتمد" },
  conditionally_compliant: { en: "Conditional — Action Required", ar: "مشروط — يتطلب إجراء" },
  non_compliant: { en: "Non-compliant — Rejected", ar: "غير مطابق — مرفوض" },
  requires_review: { en: "Requires Review", ar: "يتطلب مراجعة" },
};

const FINAL_VERDICT_TONE: Record<string, { bg: string; fg: string }> = {
  accepted: { bg: GOOD_BG, fg: GOOD },
  compliant: { bg: GOOD_BG, fg: GOOD },
  accepted_with_remarks: { bg: WARN_BG, fg: WARN },
  conditionally_compliant: { bg: WARN_BG, fg: WARN },
  requires_review: { bg: WARN_BG, fg: WARN },
  rejected: { bg: BAD_BG, fg: BAD },
  non_compliant: { bg: BAD_BG, fg: BAD },
  incomplete: { bg: CHIP_BG, fg: INK_SOFT },
};

export type AssessmentReportPdfInput = {
  locale: "ar" | "en";
  detail: AssessmentDetail;
  reportRef: string;
  generatedAt: string;
  productNameEn: string | null;
  productNameAr: string | null;
  brand: string | null;
  evaluatorName: string | null;
  reviewerName: string | null;
};

/**
 * Renders the evaluator's LabelAssessment (verdicts + fields + classification
 * + required tests) as a printable PDF, styled to match the report-engine
 * mockup (warm-paper document card, section checklist tables with pill
 * verdicts, numbered finding cards, evaluator/reviewer sign-off) rather than
 * the finance module's own template family. Grouped by KB rule section the
 * same way the on-screen workspace groups SectionCards, so the document and
 * the workspace never disagree about structure.
 */
export async function renderAssessmentReportPdf(input: AssessmentReportPdfInput): Promise<Buffer> {
  const { locale, detail } = input;
  const isAr = locale === "ar";
  const dir = isAr ? "rtl" : "ltr";
  // Source Serif 4 / IBM Plex Sans (the mockup's faces) aren't in the
  // offline-embedded font set pdf.ts ships (Montserrat, IBM Plex Mono, Atlas
  // Arabic) — PDF rendering must stay CDN-free, so Montserrat stands in for
  // the display+body role and IBM Plex Mono keeps its role for codes/data.
  const displayStack = isAr ? "'Atlas Arabic', Montserrat, Arial, sans-serif" : "Montserrat, Georgia, serif";
  const bodyStack = isAr ? "'Atlas Arabic', Montserrat, Arial, sans-serif" : "Montserrat, Arial, sans-serif";
  const fonts = await embeddedFontCss();
  const dash = "—";
  const pick = (en: string | null, ar: string | null) => (isAr ? ar?.trim() || en?.trim() || dash : en?.trim() || ar?.trim() || dash);

  const L = isAr
    ? {
        org: "شهادة المطابقة",
        orgSub: "خدمات التقييم والمطابقة",
        titleEn: "Label Evaluation Report",
        title: "تقرير تقييم البطاقة",
        domain: detail.domain === "SFDA_SUPPLEMENTS" ? "الهيئة العامة للغذاء والدواء — المكملات الغذائية" : "الهيئة العامة للغذاء والدواء — مستحضرات التجميل",
        generated: "تاريخ الإصدار",
        requestNo: "رقم الطلب",
        applicant: "الجهة المتقدمة",
        product: "المنتج",
        brand: "العلامة التجارية",
        service: "بند الخدمة",
        kbVersion: "إصدار قاعدة المعرفة",
        evaluator: "المقيّم",
        reviewer: "المراجع الفني",
        score: "نسبة المطابقة",
        checksPassed: "بند مطابق",
        checklist: "قائمة المطابقة",
        clause: "المرجع",
        requirement: "المتطلب",
        result: "النتيجة",
        note: "ملاحظة",
        findings: "النتائج المطلوب معالجتها",
        noFindings: "لا توجد نتائج تتطلب معالجة — جميع البنود مطابقة.",
        requiredTests: "الفحوصات المخبرية المطلوبة",
        testCode: "رمز الفحص",
        mandatoryLabel: "إلزامي",
        optionalLabel: "اختياري",
        reason: "السبب",
        classification: "تصنيف المنتج",
        category: "الفئة المكتشفة",
        confidence: "درجة الثقة",
        overrideNote: "تم تجاوزها يدويًا",
        evaluatedBy: "تم التقييم بواسطة",
        digitallySigned: "موقّع رقميًا",
        status: "الحالة",
        promoted: "تم اعتماد النتائج في القائمة الرسمية",
        notPromoted: "بانتظار الاعتماد في القائمة الرسمية",
        footer: "تقرير تقييم صادر عن نظام أطلس لشهادات المطابقة — للتحقق راجع رقم الطلب عبر بوابة التحقق العامة.",
      }
    : {
        org: "Certificate of Conformity",
        orgSub: "Evaluation & Compliance Services",
        titleEn: "Label Evaluation Report",
        title: "Label Evaluation Report",
        domain: detail.domain === "SFDA_SUPPLEMENTS" ? "SFDA Food & Drugs · Supplements" : "SFDA Cosmetics Technical Regulation",
        generated: "Generated",
        requestNo: "Request",
        applicant: "Applicant",
        product: "Product",
        brand: "Brand",
        service: "Service item",
        kbVersion: "KB dataset version",
        evaluator: "Evaluator",
        reviewer: "Technical reviewer",
        score: "Compliance score",
        checksPassed: "checks passed",
        checklist: "Checklist",
        clause: "Clause",
        requirement: "Requirement",
        result: "Result",
        note: "Note",
        findings: "Findings requiring resolution",
        noFindings: "No findings requiring resolution — every item is compliant.",
        requiredTests: "Required laboratory tests",
        testCode: "Test code",
        mandatoryLabel: "Mandatory",
        optionalLabel: "Optional",
        reason: "Reason",
        classification: "Product classification",
        category: "Detected category",
        confidence: "Confidence",
        overrideNote: "Manually overridden",
        evaluatedBy: "Evaluated by",
        digitallySigned: "Digitally signed",
        status: "Status",
        promoted: "Certificate binds to this request upon issuance",
        notPromoted: "Not yet promoted to the official checklist",
        footer: "This report was generated by the Atlas COC evaluation platform — verify the request number on the public verification portal.",
      };

  const verdictCounts: Record<string, number> = {};
  for (const v of detail.verdicts) verdictCounts[v.verdict] = (verdictCounts[v.verdict] ?? 0) + 1;
  const total = detail.verdicts.length || 1;
  const compliant = verdictCounts.COMPLIANT ?? 0;
  const scorePct =
    detail.overallRate != null ? Math.round(detail.overallRate * 100) : Math.round((compliant / total) * 100);
  const scoreTone = scorePct >= 85 ? GOOD : scorePct >= 60 ? WARN : BAD;

  const bySection = new Map<string, typeof detail.verdicts>();
  for (const v of detail.verdicts) {
    const key = v.section?.trim() || (isAr ? "عام" : "General");
    const list = bySection.get(key) ?? [];
    list.push(v);
    bySection.set(key, list);
  }

  const checklistSections = [...bySection.entries()]
    .map(
      ([section, verdicts]) => `
    <div class="rule-section">
      <div class="rule-section-head">
        <span>${esc(section)}</span>
        <span class="count">${verdicts.filter((v) => v.verdict === "COMPLIANT").length} / ${verdicts.length} ${L.checksPassed}</span>
      </div>
      <table class="checklist">
        <thead><tr><th>${L.requirement}</th><th>${L.clause}</th><th>${L.result}</th><th>${L.note}</th></tr></thead>
        <tbody>
          ${verdicts
            .map((v) => {
              const tone = VERDICT_TONE[v.verdict] ?? VERDICT_TONE.NA;
              const label = VERDICT_LABEL[v.verdict]?.[isAr ? "ar" : "en"] ?? v.verdict;
              return `<tr>
                <td class="req">${esc(pick(v.titleEn, v.titleAr))}</td>
                <td class="mono ref">${esc(v.code)}${v.priority ? ` · ${esc(v.priority)}` : ""}</td>
                <td><span class="chk" style="background:${tone.bg};color:${tone.fg}"><span class="ico" style="background:${tone.fg}">${VERDICT_ICON[tone.icon]}</span>${esc(label)}</span></td>
                <td class="note">${esc(v.evidenceText?.trim() || v.rationale?.trim() || dash)}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`,
    )
    .join("");

  const findings = detail.verdicts.filter((v) => FINDING_VERDICTS.has(v.verdict));
  const findingsHtml = findings.length
    ? findings
        .map((v, i) => {
          const isCritical = v.verdict === "NON_COMPLIANT" || v.verdict === "MISSING";
          const tone = isCritical ? BAD : WARN;
          return `<div class="finding" style="border-inline-start-color:${tone}">
          <div class="f-num mono">${String(i + 1).padStart(2, "0")}</div>
          <div class="f-body">
            <h4>${esc(pick(v.titleEn, v.titleAr))}</h4>
            <p>${esc(v.rationale?.trim() || v.evidenceText?.trim() || dash)}</p>
            <span class="f-clause mono">${esc(v.code)}${v.section ? ` · ${esc(v.section)}` : ""} · ${isAr ? (isCritical ? "حرج" : "استشاري") : isCritical ? "blocking" : "advisory"}</span>
          </div>
        </div>`;
        })
        .join("")
    : `<div class="finding" style="border-inline-start-color:${GOOD}"><div class="f-body"><p class="muted">${L.noFindings}</p></div></div>`;

  const requiredTestsHtml = detail.requiredTests.length
    ? `<div class="section">
        <div class="section-head">${L.requiredTests}</div>
        <table class="checklist">
          <thead><tr><th>${L.testCode}</th><th>${L.result}</th><th>${L.reason}</th></tr></thead>
          <tbody>
            ${detail.requiredTests
              .map(
                (rt) => `<tr>
                <td class="mono req">${esc(rt.testCode)}</td>
                <td><span class="chk" style="background:${rt.mandatory ? BAD_BG : CHIP_BG};color:${rt.mandatory ? BAD : INK_SOFT}">${rt.mandatory ? L.mandatoryLabel : L.optionalLabel}</span></td>
                <td class="note">${esc(pick(rt.reasonEn, rt.reasonAr))}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : "";

  const classificationHtml = detail.classification
    ? `<div class="meta-grid">
        <div class="meta-item"><div class="k">${L.classification} — ${L.category}</div><div class="v mono">${esc(
          detail.classification.overrideCategoryCode || detail.classification.detectedCategoryCode || dash,
        )}${detail.classification.overrideCategoryCode ? ` (${L.overrideNote})` : ""}</div></div>
        <div class="meta-item"><div class="k">${L.confidence}</div><div class="v">${
          detail.classification.detectedConfidence != null ? `${Math.round(detail.classification.detectedConfidence * 100)}%` : dash
        }</div></div>
      </div>`
    : "";

  const finalTone = FINAL_VERDICT_TONE[detail.finalVerdict ?? "incomplete"] ?? FINAL_VERDICT_TONE.incomplete;
  const finalLabel = FINAL_VERDICT_LABEL[detail.finalVerdict ?? "incomplete"]?.[isAr ? "ar" : "en"] ?? detail.finalVerdict ?? dash;

  const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<style>
${fonts}
*{box-sizing:border-box}
body{font-family:${bodyStack};color:${INK};margin:0;font-size:11px;background:${PAPER}}
h1,h2,h3,h4{margin:0;font-family:${displayStack}}
.mono{font-family:'IBM Plex Mono',monospace}
.muted{color:${INK_SOFT}}
.sheet{background:${PAPER_RAISED};border:1px solid ${LINE};border-radius:10px;overflow:hidden}

.doc-head{display:flex;justify-content:space-between;gap:16px;padding:20px 26px 16px;border-bottom:1px solid ${LINE};background:${ACCENT_SOFT}}
.brandmark{display:flex;align-items:center;gap:10px}
.brandmark .mark{width:32px;height:32px;border-radius:7px;background:${ACCENT};color:#fff;display:flex;align-items:center;justify-content:center;font-family:${displayStack};font-weight:700;font-size:14px;flex:none}
.brandmark .org{font-family:${displayStack};font-weight:700;font-size:13.5px}
.brandmark .org-sub{font-size:9px;color:${INK_SOFT};font-family:'IBM Plex Mono',monospace;letter-spacing:0.02em}
.doc-ref{text-align:${isAr ? "left" : "right"};font-size:9.5px;color:${INK_SOFT}}
.doc-ref .ref-id{font-family:'IBM Plex Mono',monospace;font-size:11px;color:${INK};font-weight:700}
.doc-ref .ref-row{margin-top:2px}

.doc-title-row{padding:16px 26px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.doc-title-row h1{font-size:18px;font-weight:700}
.doc-sub{color:${INK_SOFT};font-size:10.5px;margin-top:2px}
.status-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border-radius:999px;font-weight:700;font-size:10px;white-space:nowrap}
.status-pill .dot{width:6px;height:6px;border-radius:50%;background:currentColor}

.doc-body{padding:16px 26px 22px}
.meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 20px;padding:14px 0;border-bottom:1px dashed ${LINE_STRONG};margin-bottom:16px}
.meta-item .k{font-size:8.5px;text-transform:uppercase;letter-spacing:0.06em;color:${INK_SOFT};font-weight:600;margin-bottom:3px}
.meta-item .v{font-size:11px;font-weight:600}
.meta-item .v.mono{font-family:'IBM Plex Mono',monospace;font-size:10.5px}

.score-row{display:flex;align-items:center;gap:18px;padding:12px 16px;background:${CHIP_BG};border-radius:8px;margin-bottom:18px}
.score-num{font-family:${displayStack};font-size:26px;font-weight:700;line-height:1}
.score-num sup{font-size:11px;font-weight:500;color:${INK_SOFT}}
.score-bar-wrap{flex:1}
.score-bar-lbl{font-size:9px;color:${INK_SOFT};margin-bottom:5px;display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace}
.score-bar{height:6px;border-radius:99px;background:${LINE};overflow:hidden}
.score-bar i{display:block;height:100%;border-radius:99px}

.section{margin-bottom:18px}
.section-head{font-size:12px;font-weight:700;margin-bottom:8px;color:${INK};break-after:avoid;font-family:${displayStack}}
.rule-section{margin-bottom:16px}
.rule-section-head{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;font-weight:700;margin-bottom:6px;font-family:${displayStack};break-after:avoid}
.rule-section-head .count{font-size:8.5px;color:${INK_SOFT};font-weight:400;font-family:'IBM Plex Mono',monospace}

table.checklist{width:100%;border-collapse:collapse;font-size:9.5px}
table.checklist thead{display:table-header-group}
table.checklist tr{break-inside:avoid}
table.checklist th{text-align:${isAr ? "right" : "left"};font-size:8px;text-transform:uppercase;letter-spacing:0.04em;color:${INK_SOFT};font-weight:600;padding:0 8px 6px 0;border-bottom:1px solid ${LINE_STRONG}}
table.checklist td{padding:7px 8px 7px 0;border-bottom:1px solid ${LINE};vertical-align:top;text-align:${isAr ? "right" : "left"}}
table.checklist td.req{font-weight:600;width:32%}
table.checklist td.ref{white-space:nowrap;color:${INK_SOFT}}
table.checklist td.note{color:${INK_SOFT}}

.chk{display:inline-flex;align-items:center;gap:5px;font-weight:700;font-size:9px;white-space:nowrap;padding:2px 9px 2px 6px;border-radius:99px}
.chk .ico{width:11px;height:11px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:7px;color:#fff;flex:none}

.finding{display:flex;gap:10px;padding:9px 11px;border:1px solid ${LINE};border-inline-start:3px solid ${LINE_STRONG};border-radius:6px;margin-bottom:7px;background:${PAPER}}
.f-num{font-size:8.5px;color:${INK_SOFT};font-family:'IBM Plex Mono',monospace;width:18px;flex:none;padding-top:1px}
.f-body h4{font-size:10px;font-weight:700;margin-bottom:2px}
.f-body p{margin:0;font-size:9px;color:${INK_SOFT}}
.f-clause{display:inline-block;margin-top:5px;font-size:8px;color:${INK_SOFT};background:${CHIP_BG};padding:2px 7px;border-radius:4px}

.signoff{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-top:16px;border-top:1px solid ${LINE};margin-top:6px}
.sign-block .k{font-size:8.5px;text-transform:uppercase;letter-spacing:0.06em;color:${INK_SOFT};font-weight:600;margin-bottom:5px}
.sign-block .name{font-weight:700;font-size:11px}
.sign-block .role{font-size:9px;color:${INK_SOFT};margin-top:1px}
.sign-block .stamp{margin-top:6px;display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:8px;color:${ACCENT};border:1px solid ${ACCENT};padding:3px 8px;border-radius:4px;letter-spacing:0.02em}

.doc-foot{padding:12px 26px;border-top:1px solid ${LINE};background:${CHIP_BG};display:flex;justify-content:space-between;gap:16px;font-size:8.5px;color:${INK_SOFT};font-family:'IBM Plex Mono',monospace}
</style>
</head>
<body>
<div class="sheet">
  <header class="doc-head">
    <div class="brandmark">
      <div class="mark">CC</div>
      <div>
        <div class="org">${esc(L.org)}</div>
        <div class="org-sub">${esc(L.orgSub)}</div>
      </div>
    </div>
    <div class="doc-ref">
      <div class="ref-id">${esc(input.reportRef)}</div>
      <div class="ref-row">${L.generated}: ${esc(input.generatedAt)}</div>
      <div class="ref-row">${L.requestNo}: <span class="mono">${esc(detail.requestNo)}</span></div>
    </div>
  </header>

  <div class="doc-title-row">
    <div>
      <h1>${esc(L.title)}</h1>
      <div class="doc-sub">${esc(L.domain)}</div>
    </div>
    <span class="status-pill" style="background:${finalTone.bg};color:${finalTone.fg}"><span class="dot"></span>${esc(finalLabel)}</span>
  </div>

  <div class="doc-body">
    <div class="meta-grid">
      <div class="meta-item"><div class="k">${L.applicant}</div><div class="v">${esc(detail.organisationName)}</div></div>
      <div class="meta-item"><div class="k">${L.product}</div><div class="v">${esc(pick(input.productNameEn, input.productNameAr))}</div></div>
      <div class="meta-item"><div class="k">${L.brand}</div><div class="v">${esc(input.brand?.trim() || dash)}</div></div>
      <div class="meta-item"><div class="k">${L.service}</div><div class="v mono">${esc(detail.serviceItemCode)}</div></div>
      <div class="meta-item"><div class="k">${L.kbVersion}</div><div class="v mono">${esc(detail.kbVersionLabel)}</div></div>
      <div class="meta-item"><div class="k">${L.evaluator}</div><div class="v">${esc(input.evaluatorName?.trim() || detail.claimedByName || dash)}</div></div>
    </div>

    ${
      detail.domain === "SFDA_SUPPLEMENTS"
        ? `<div class="score-row">
            <div class="score-num" style="color:${scoreTone}">${scorePct}<sup>/100</sup></div>
            <div class="score-bar-wrap">
              <div class="score-bar-lbl"><span>${L.score}</span><span>${compliant} / ${detail.verdicts.length} ${L.checksPassed}</span></div>
              <div class="score-bar"><i style="width:${Math.min(100, Math.max(0, scorePct))}%;background:${scoreTone}"></i></div>
            </div>
          </div>`
        : ""
    }

    ${classificationHtml}

    <div class="section">
      <div class="section-head">${L.checklist}</div>
      ${checklistSections}
    </div>

    ${requiredTestsHtml}

    <div class="section">
      <div class="section-head">${L.findings}</div>
      ${findingsHtml}
    </div>

    <div class="signoff">
      <div class="sign-block">
        <div class="k">${L.evaluatedBy}</div>
        <div class="name">${esc(input.evaluatorName?.trim() || detail.claimedByName || dash)}</div>
        <span class="stamp">✓ ${L.digitallySigned.toUpperCase()}</span>
      </div>
      <div class="sign-block">
        <div class="k">${input.reviewerName ? L.reviewer : L.status}</div>
        <div class="name">${input.reviewerName?.trim() || (detail.promotedAt ? L.promoted : L.notPromoted)}</div>
        ${input.reviewerName ? `<span class="stamp">✓ ${L.digitallySigned.toUpperCase()}</span>` : ""}
      </div>
    </div>
  </div>

  <footer class="doc-foot">
    <span>${L.footer}</span>
    <span class="mono">${esc(input.reportRef)}</span>
  </footer>
</div>
</body>
</html>`;

  return htmlToPdf(html);
}
