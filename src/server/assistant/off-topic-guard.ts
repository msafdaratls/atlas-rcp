/**
 * A cheap, deterministic pre-filter that catches obvious non-Atlas requests
 * (creative writing, trivia, "solve my homework", prompt-injection probes
 * like "ignore your instructions") before spending a paid Claude call on
 * them. The system prompt already instructs the model to decline off-topic
 * questions — this is defense in depth plus a token-cost cut for the
 * clearest cases; anything ambiguous still reaches the model, which remains
 * the real backstop. Conservative by design: it only fires when the message
 * has an off-topic signal AND zero on-topic signal, so a real Atlas question
 * phrased oddly still goes through.
 */
const ON_TOPIC_SIGNAL_WORDS = [
  "request", "certificate", "label", "document", "invoice", "price", "cost", "service", "catalogue",
  "catalog", "sla", "status", "upload", "payment", "pay", "resubmi", "notification", "support",
  "atlas", "portal", "regulat", "complian", "standard", "clause", "evaluat", "assessment", "inspection", "audit",
  "sfda", "gso", "saso", "saber", "pcoc", "scoc", "cosmetic", "supplement", "laboratory", "lab test",
  "طلب", "شهادة", "ملصق", "مستند", "فاتورة", "سعر", "خدمة", "الكتالوج", "مدة", "حالة", "رفع", "دفع",
  "إعادة تقديم", "إشعار", "الدعم", "أطلس", "البوابة", "تنظيم", "مطابقة", "معيار", "بند", "تقييم", "تفتيش", "تدقيق",
];

const OFF_TOPIC_SIGNAL_WORDS = [
  "poem", "joke", "riddle", "trivia", "weather forecast", "football score", "movie recommendation",
  "recipe for", "write code", "python script", "javascript code", "solve this equation", "my homework",
  "translate this into", "what model are you", "are you chatgpt", "are you gpt", "ignore previous instructions",
  "ignore your instructions", "your system prompt",
  "قصيدة", "نكتة", "لغز", "الطقس", "كرة القدم", "رشح فيلم", "وصفة طبخ", "اكتب لي كود", "حل هذه المعادلة",
  "واجب مدرسي", "ترجم هذا", "تجاهل التعليمات", "تجاهل تعليماتك",
];

export function isLikelyOffTopic(text: string): boolean {
  const normalized = text.toLowerCase();
  if (ON_TOPIC_SIGNAL_WORDS.some((w) => normalized.includes(w))) return false;
  return OFF_TOPIC_SIGNAL_WORDS.some((w) => normalized.includes(w));
}

export const OFF_TOPIC_REPLY = {
  en: "I'm the Atlas Assistant — I can only help with Atlas's certification services and this portal (submitting requests, requirements, pricing, timelines, and how assessment works). For anything else, please reach out through the Support page.",
  ar: "أنا مساعد أطلس — يمكنني المساعدة فقط في خدمات أطلس للتصديق وهذه البوابة (تقديم الطلبات، المتطلبات، الأسعار، المدد، وآلية التقييم). لأي أمر آخر، يرجى التواصل عبر صفحة الدعم.",
};
