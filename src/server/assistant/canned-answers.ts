/**
 * Static Q&A shortcuts for the client assistant chat. Matched entries answer
 * the turn directly — no Claude call, no tokens spent. Deliberately scoped to
 * generic platform/process questions only: nothing here states a price, SLA,
 * or document list (those live in the catalogue and change over time — the
 * AI path answers those, grounded in the live catalogueContext, so they
 * never go stale). See `mentionsSpecificService` below: any message that
 * names a service, code, or regulatory scheme skips canned matching
 * entirely and falls through to the AI, so a flagship question like "What
 * documents do I need for a Cosmetics SCOC?" still gets a real, grounded
 * answer instead of a generic redirect.
 */
export type CannedAnswer = { en: string; ar: string };

type CannedEntry = CannedAnswer & { id: string; keywords: string[] };

const CANNED_ANSWERS: CannedEntry[] = [
  {
    id: "new_request",
    keywords: ["submit a request", "new request", "create a request", "how do i apply", "apply for", "طلب جديد", "تقديم طلب", "إنشاء طلب"],
    en: "To submit a new request: open **New Request** from the portal menu, pick the service you need, and follow the wizard — it shows the exact price, SLA, and required documents for that service before you submit, then walks you through document upload and payment.",
    ar: "لتقديم طلب جديد: افتح **طلب جديد** من قائمة البوابة، واختر الخدمة المطلوبة، ثم اتبع خطوات المعالج — سيعرض لك السعر ومدة الإنجاز والمستندات المطلوبة بالضبط لتلك الخدمة قبل التقديم، ثم يرشدك خلال رفع المستندات والدفع.",
  },
  {
    id: "check_status",
    keywords: ["request status", "track my request", "check status", "where is my request", "حالة الطلب", "تتبع طلبي", "متابعة الطلب"],
    en: "You can track a request's status any time from the **Requests** page — it shows the current stage (e.g. under review, awaiting documents, report issued) and any action needed from you. I can't see individual request details myself, so that page is the accurate source.",
    ar: "يمكنك متابعة حالة الطلب في أي وقت من صفحة **الطلبات** — تعرض المرحلة الحالية (قيد المراجعة، بانتظار مستندات، صدور التقرير) وأي إجراء مطلوب منك. لا يمكنني الاطلاع على تفاصيل طلب محدد، لذا هذه الصفحة هي المرجع الدقيق.",
  },
  {
    id: "payment_invoice",
    keywords: ["invoice", "how do i pay", "payment method", "billing", "فاتورة", "طريقة الدفع", "سداد"],
    en: "Invoices are generated once a request is priced, and can be paid and reviewed from the **Invoices** page in the portal — you'll also get a notification when a new invoice is ready.",
    ar: "تُصدر الفواتير بعد تسعير الطلب، ويمكن سدادها ومراجعتها من صفحة **الفواتير** في البوابة — وستصلك إشعار عند إصدار فاتورة جديدة.",
  },
  {
    id: "certificate_download",
    keywords: ["download certificate", "download report", "get my certificate", "تنزيل الشهادة", "تحميل الشهادة", "تنزيل التقرير"],
    en: "Once a certificate or report is issued, it's attached to that request and downloadable from the **Requests** page — open the request and look for the issued document.",
    ar: "بمجرد إصدار الشهادة أو التقرير، يتم إرفاقه بالطلب ويمكن تنزيله من صفحة **الطلبات** — افتح الطلب وابحث عن المستند الصادر.",
  },
  {
    id: "how_assessment_works",
    keywords: ["how does assessment work", "how does evaluation work", "assessment process", "evaluation process", "آلية التقييم", "كيف يتم التقييم", "عملية التقييم"],
    en: "In general: your documents are collected, checked clause-by-clause against the applicable Saudi standard, reviewed by a technical reviewer, and a decision is issued. Some services also involve inspection, lab testing, or a factory audit — the service page tells you which.",
    ar: "بشكل عام: تُجمع مستنداتك، وتُراجَع بندًا ببند وفق المعيار السعودي المعني، ثم يراجعها مُقيّم فني، ويصدر القرار. بعض الخدمات تتضمن أيضًا تفتيشًا أو اختبارًا مخبريًا أو تدقيق مصنع — وتوضح صفحة الخدمة ذلك.",
  },
  {
    id: "notifications",
    keywords: ["notifications", "email updates", "alerts", "إشعارات", "تنبيهات"],
    en: "You'll get an in-portal notification (and email, where enabled) whenever your request moves stage — documents requested, report issued, invoice ready, and so on. Check the bell icon in the top bar for the full list.",
    ar: "ستصلك إشعارات داخل البوابة (وعبر البريد الإلكتروني عند تفعيله) عند انتقال طلبك لأي مرحلة — طلب مستندات، صدور تقرير، جاهزية فاتورة، وغير ذلك. تحقق من أيقونة الجرس في الشريط العلوي لعرض القائمة الكاملة.",
  },
  {
    id: "contact_support",
    keywords: ["contact support", "talk to someone", "speak to an agent", "human agent", "تواصل مع الدعم", "التحدث مع شخص", "الدعم الفني"],
    en: "For anything I can't help with, open the **Support** page in the portal — the team there can look into account- or request-specific issues directly.",
    ar: "لأي أمر لا أستطيع المساعدة فيه، افتح صفحة **الدعم** في البوابة — يمكن لفريق الدعم متابعة المسائل الخاصة بحسابك أو طلبك مباشرة.",
  },
];

/** Regulatory-scheme codes like "SAB-001" or "LAB-001" — always treated as a specific-service mention. */
const SERVICE_CODE_PATTERN = /\b[a-z]{2,6}-\d{2,4}\b/i;

const SERVICE_SIGNAL_WORDS = [
  "sfda", "gso", "saso", "saber", "pcoc", "scoc", "cosmetic", "supplement", "laboratory",
  "lab test", "factory audit", "fragrance", "perfume", "medical device",
  "مستحضرات", "التجميل", "مكملات", "المكملات", "المختبر", "تدقيق المصنع", "الأغذية", "الأدوية",
];

/** A message naming a specific service/code/regulatory scheme always skips canned matching — see module doc. */
function mentionsSpecificService(normalized: string): boolean {
  return SERVICE_CODE_PATTERN.test(normalized) || SERVICE_SIGNAL_WORDS.some((w) => normalized.includes(w));
}

/**
 * Returns a canned answer only on an unambiguous, generic match: at least
 * one keyword hit, and a single clear best-scoring entry (a tie defers to
 * the AI rather than guessing).
 */
export function matchCannedAnswer(text: string): CannedAnswer | null {
  const normalized = text.toLowerCase();
  if (mentionsSpecificService(normalized)) return null;

  let best: { entry: CannedEntry; score: number } | null = null;
  let tied = false;
  for (const entry of CANNED_ANSWERS) {
    const score = entry.keywords.reduce((acc, kw) => acc + (normalized.includes(kw) ? 1 : 0), 0);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { entry, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  return { en: best.entry.en, ar: best.entry.ar };
}
