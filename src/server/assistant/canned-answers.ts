import {
  bestMatch,
  suggestEntries,
  topicLabel,
  type KeywordEntry,
} from "@/server/assistant/keyword-match";

/**
 * The client assistant's stored answer bank.
 *
 * With the AI fallback switched off (see ai-toggle.ts) this bank, plus the
 * two live-data lookups that run before it (regulatory-lookup.ts against the
 * active KB, service-lookup.ts against the active catalogue), is the whole
 * assistant. So it aims at full coverage of the client portal rather than
 * the handful of shortcuts it started as.
 *
 * The division of labour is unchanged and deliberate: nothing here states a
 * price, SLA, or per-service document list. Those are per-service, change
 * over time, and are answered from the live catalogue row by
 * service-lookup.ts — a canned string would go stale silently. Entries here
 * cover process, navigation, and platform mechanics, which don't.
 *
 * See `mentionsSpecificService`: when the AI fallback is ON, a message
 * naming a specific service skips this bank so it reaches the model with
 * full catalogue grounding. When the AI is OFF there is nothing better to
 * fall through to, so the generic process answer is served instead of a
 * dead end.
 */
export type CannedAnswer = { en: string; ar: string };

type CannedEntry = CannedAnswer & KeywordEntry;

const CANNED_ANSWERS: CannedEntry[] = [
  // ── Getting oriented ──────────────────────────────────────────────────
  {
    id: "portal_overview",
    keywords: ["what can i do here", "portal overview", "how does this portal work", "navigate the portal", "ما الذي يمكنني فعله هنا", "نظرة عامة على البوابة", "كيف تعمل البوابة"],
    en: "The client portal has seven areas, in the left-hand menu: **Dashboard** (what needs your attention), **New request** (submit a service request), **My requests** (track everything in progress), **Reports** (issued reports and certificates), **Statement** (balance, pro forma invoices, payments), **Company profile** (your organisation's details, users and preferences), and **Support** (how to reach Atlas).",
    ar: "تحتوي بوابة العملاء على سبعة أقسام في القائمة الجانبية: **لوحة التحكم** (ما يحتاج انتباهك)، **طلب جديد** (تقديم طلب خدمة)، **طلباتي** (متابعة كل ما هو قيد التنفيذ)، **التقارير** (التقارير والشهادات الصادرة)، **كشف الحساب** (الرصيد والفواتير المبدئية والمدفوعات)، **ملف الشركة** (بيانات مؤسستك ومستخدموها وتفضيلاتها)، و**الدعم** (طرق التواصل مع أطلس).",
  },
  {
    id: "dashboard",
    keywords: ["dashboard", "home page", "needs my attention", "لوحة التحكم", "الصفحة الرئيسية", "يحتاج انتباهي"],
    en: "The **Dashboard** is your home page: anything returned for corrections appears at the top under *Needs your attention*, alongside counts of open requests, requests in review, reports issued this year, and your current balance, plus a recent-activity feed and a shortcut to start a new request.",
    ar: "**لوحة التحكم** هي صفحتك الرئيسية: يظهر في أعلاها كل ما أُعيد للتصحيح تحت *يحتاج انتباهك*، إلى جانب أعداد الطلبات المفتوحة والطلبات قيد المراجعة والتقارير الصادرة هذا العام ورصيدك الحالي، مع سجل للنشاط الأخير واختصار لبدء طلب جديد.",
  },
  {
    id: "assistant_scope",
    keywords: ["what can you help with", "what do you do", "who are you", "can you help me", "بماذا يمكنك المساعدة", "ماذا تفعل", "من أنت", "هل يمكنك مساعدتي"],
    en: "I'm the Atlas Assistant. I can explain how to use this portal (submitting a request, uploading documents, resubmissions, invoices and payment), what any service in the catalogue requires — its documents, price and timeline — and what a regulatory clause on file says. I can't see your individual requests or account data, and I can't tell you whether a product will pass; for those, use the **My requests** page or the **Support** page.",
    ar: "أنا مساعد أطلس. يمكنني شرح كيفية استخدام هذه البوابة (تقديم طلب، رفع المستندات، إعادة التقديم، الفواتير والدفع)، وما تتطلبه أي خدمة في الكتالوج من مستندات وسعر ومدة إنجاز، وما ينص عليه أي بند تنظيمي مسجّل لدينا. لا يمكنني الاطلاع على طلباتك أو بيانات حسابك، ولا أستطيع إخبارك بما إذا كان المنتج سيجتاز التقييم؛ لهذين الأمرين استخدم صفحة **طلباتي** أو صفحة **الدعم**.",
  },

  // ── Submitting a request ──────────────────────────────────────────────
  {
    id: "new_request",
    keywords: ["submit a request", "new request", "create a request", "start a request", "how do i apply", "apply for a service", "raise a request", "طلب جديد", "تقديم طلب", "إنشاء طلب", "بدء طلب", "كيف أتقدم بطلب"],
    en: "Open **New request** from the portal menu and follow the four steps — the wizard shows the exact price, timeline and required documents for the service you pick before you commit, then walks you through product details, document upload, and a final review before submitting.",
    ar: "افتح **طلب جديد** من قائمة البوابة واتبع الخطوات الأربع — يعرض لك المعالج السعر ومدة الإنجاز والمستندات المطلوبة بالضبط للخدمة التي تختارها قبل الالتزام، ثم يرشدك عبر تفاصيل المنتج ورفع المستندات ومراجعة نهائية قبل التقديم.",
  },
  {
    id: "wizard_steps",
    keywords: ["steps of the wizard", "four steps", "request wizard", "what are the steps", "خطوات المعالج", "الخطوات الأربع", "معالج الطلب", "ما هي الخطوات"],
    en: "The New request wizard has four steps: **1 · Service** (pick the category, subcategory and service), **2 · Product** (product name in English and Arabic, brand, and the fields that service needs), **3 · Documents** (upload each required document), **4 · Review** (check everything, accept the declaration, and submit). You can move back and forth freely; the draft saves automatically.",
    ar: "يتكوّن معالج الطلب الجديد من أربع خطوات: **1 · الخدمة** (اختيار الفئة والفئة الفرعية والخدمة)، **2 · المنتج** (اسم المنتج بالعربية والإنجليزية والعلامة التجارية والحقول التي تتطلبها تلك الخدمة)، **3 · المستندات** (رفع كل مستند مطلوب)، **4 · المراجعة** (التحقق من كل شيء وقبول الإقرار والتقديم). يمكنك التنقل بين الخطوات بحرية، وتُحفظ المسودة تلقائياً.",
  },
  {
    id: "choose_service",
    keywords: ["which service do i need", "choose the right service", "pick a service", "not sure which service", "أي خدمة أحتاج", "اختيار الخدمة المناسبة", "لست متأكداً من الخدمة"],
    en: "Step 1 of the wizard narrows it down for you: choose the category (for example Cosmetics, or Food & Drugs), then the subcategory, and it lists only the services offered under it — each with its price, timeline and required-document count. Tell me the service name and I'll give you its full requirements; if you're still unsure which applies to your product, the Support page can confirm before you submit.",
    ar: "تُضيّق الخطوة الأولى من المعالج الخيارات نيابةً عنك: اختر الفئة (مستحضرات التجميل أو الأغذية والأدوية مثلاً)، ثم الفئة الفرعية، فتظهر الخدمات المتاحة ضمنها فقط — مع سعر كل منها ومدة إنجازها وعدد مستنداتها المطلوبة. أخبرني باسم الخدمة وسأعطيك متطلباتها كاملة؛ وإن بقي لديك تردد في الخدمة المناسبة لمنتجك، يمكن لصفحة الدعم تأكيد ذلك قبل التقديم.",
  },
  {
    id: "product_details",
    keywords: ["product details step", "product name arabic", "brand field", "product fields", "خطوة تفاصيل المنتج", "اسم المنتج بالعربية", "حقل العلامة التجارية", "حقول المنتج"],
    en: "Step 2 asks for the product name in **both English and Arabic**, the brand, and any extra fields the service you chose needs (dosage form, pack size, SABER request number, and so on). Fields marked required must be filled before you can continue; you can correct them later from the request page while it's still with intake.",
    ar: "تطلب الخطوة الثانية اسم المنتج **بالعربية والإنجليزية معاً** والعلامة التجارية وأي حقول إضافية تتطلبها الخدمة المختارة (الشكل الصيدلاني، حجم العبوة، رقم طلب سابر، وما إلى ذلك). يجب تعبئة الحقول الإلزامية قبل المتابعة، ويمكنك تصحيحها لاحقاً من صفحة الطلب ما دام لدى قسم الاستلام.",
  },
  {
    id: "upload_documents",
    keywords: ["upload documents", "how do i upload", "attach files", "required documents step", "رفع المستندات", "كيف أرفع", "إرفاق ملفات", "خطوة المستندات المطلوبة"],
    en: "Step 3 lists every document the service requires, with a counter showing how many you've provided. Drop a file onto a slot or click it to browse. Documents marked *optional* can be skipped; the required ones must all be filled before the Review step will let you submit. You can replace any file before submitting, and add extra supporting files under *Additional documents*.",
    ar: "تعرض الخطوة الثالثة كل مستند تتطلبه الخدمة، مع عدّاد يوضح ما قدّمته منها. أفلت الملف في الخانة المخصصة أو اضغط عليها للاستعراض. يمكن تخطي المستندات المؤشّر عليها بـ*اختياري*، أما المستندات الإلزامية فيجب استكمالها جميعاً قبل أن تسمح لك خطوة المراجعة بالتقديم. ويمكنك استبدال أي ملف قبل التقديم، وإضافة ملفات داعمة إضافية ضمن *مستندات إضافية*.",
  },
  {
    id: "document_templates",
    keywords: ["download template", "blank form", "declaration form", "template for the form", "تحميل النموذج", "نموذج فارغ", "نموذج الإقرار", "استمارة"],
    en: "Where Atlas publishes a blank form for a document, the upload slot shows a **Download template** link — fill it in, sign it, and upload it back into the same slot. Some documents offer several variants (for example a risk assessment per technical regulation); in that case the slot asks you to pick the one matching your product first.",
    ar: "عندما تنشر أطلس نموذجاً فارغاً لمستند ما، تظهر في خانة الرفع رابط **تحميل النموذج** — عبّئه ووقّعه ثم ارفعه في الخانة نفسها. وتوفّر بعض المستندات عدة صيغ (مثل تقييم المخاطر حسب اللائحة الفنية)، وعندها تطلب منك الخانة اختيار الصيغة المطابقة لمنتجك أولاً.",
  },
  {
    id: "file_types",
    keywords: ["file type", "word file", "excel file", "accepted file types", "file format", "file size limit", "pdf or image", "file rejected", "نوع الملف", "صيغة الملف", "حجم الملف", "رفض الملف"],
    en: "Accepted formats and the maximum size are set per document, and are shown on that document's upload slot — most accept PDF, PNG and JPG. If a file is rejected, the message names what that slot accepts and what you uploaded; convert the file to a listed format and try again.",
    ar: "تُحدَّد الصيغ المقبولة والحجم الأقصى لكل مستند على حدة، وتظهر في خانة رفع ذلك المستند — ومعظمها يقبل PDF و PNG و JPG. وإذا رُفض ملف، توضّح الرسالة ما تقبله تلك الخانة وما الذي رفعته؛ حوّل الملف إلى إحدى الصيغ المذكورة وأعد المحاولة.",
  },
  {
    id: "coupon",
    keywords: ["coupon", "discount code", "promo code", "voucher code", "قسيمة", "رمز الخصم", "رمز ترويجي"],
    en: "If you have a discount code, enter it in the **Coupon code** box on the Review step and press *Apply coupon* — the total updates immediately. Codes can be limited to certain categories or services, to new clients, to a minimum order value, or to a number of uses; if yours is refused the message says which condition wasn't met.",
    ar: "إذا كان لديك رمز خصم، أدخله في خانة **رمز القسيمة** في خطوة المراجعة واضغط *تطبيق القسيمة* — فيتحدّث الإجمالي فوراً. وقد تكون الرموز مقيّدة بفئات أو خدمات معيّنة، أو بالعملاء الجدد، أو بحد أدنى لقيمة الطلب، أو بعدد مرات استخدام؛ وإذا رُفض رمزك توضّح الرسالة الشرط الذي لم يتحقق.",
  },
  {
    id: "declaration_submit",
    keywords: ["declaration", "before i submit", "confirm accuracy", "final step", "الإقرار", "قبل التقديم", "تأكيد صحة البيانات", "الخطوة الأخيرة"],
    en: "The Review step shows everything you entered plus the final price, and asks you to accept a declaration confirming the information is accurate and that your organisation takes responsibility for it. Ticking that box enables **Submit request**; once submitted you get a request number and the request opens automatically.",
    ar: "تعرض خطوة المراجعة كل ما أدخلته إضافةً إلى السعر النهائي، وتطلب منك قبول إقرار يؤكد صحة المعلومات وتحمّل مؤسستك المسؤولية عنها. وبتأشير هذا المربع يُفعَّل زر **تقديم الطلب**؛ وبمجرد التقديم تحصل على رقم الطلب ويُفتح الطلب تلقائياً.",
  },
  {
    id: "draft",
    keywords: ["draft", "unfinished request", "saved automatically", "continue later", "discard draft", "مسودة", "طلب غير مكتمل", "يُحفظ تلقائياً", "الإكمال لاحقاً", "تجاهل المسودة"],
    en: "A request you haven't submitted yet is saved as a **Draft** automatically as you go — close the tab and it's still there. Drafts appear in **My requests** with an option to *Continue draft*, or to *Discard draft* if you no longer need it (discarding can't be undone).",
    ar: "يُحفَظ الطلب الذي لم تقدّمه بعد **كمسودة** تلقائياً أثناء العمل — أغلق التبويب وستجده كما تركته. تظهر المسودات في **طلباتي** مع خيار *إكمال المسودة*، أو *تجاهل المسودة* إن لم تعد بحاجة إليها (والتجاهل لا يمكن التراجع عنه).",
  },
  {
    id: "after_submit",
    keywords: ["what happens after i submit", "what happens next", "after submitting", "ماذا يحدث بعد التقديم", "ما الخطوة التالية", "بعد تقديم الطلب"],
    en: "Your request goes to Atlas's intake team first, who check the file is complete. If something is missing they return it to you for corrections; otherwise it's accepted and moves into evaluation, then technical review, then a decision, and finally the report or certificate is issued. You get a notification at every one of those steps.",
    ar: "ينتقل طلبك أولاً إلى فريق الاستلام في أطلس الذي يتحقق من اكتمال الملف. فإن نقص شيء أُعيد إليك للتصحيح، وإلا فيُقبل وينتقل إلى التقييم ثم المراجعة الفنية ثم القرار، وأخيراً يصدر التقرير أو الشهادة. ويصلك إشعار عند كل خطوة من هذه الخطوات.",
  },

  // ── Tracking a request ────────────────────────────────────────────────
  {
    id: "check_status",
    keywords: ["request status", "track my request", "check status", "where is my request", "my requests page", "حالة الطلب", "تتبع طلبي", "متابعة الطلب", "أين وصل طلبي", "صفحة طلباتي"],
    en: "Open **My requests** — it lists every request for your organisation with its current state, submission number and last-updated date, and you can search or filter by state. Click *Open* on a row for the full timeline, documents and any action needed from you. I can't see individual request details myself, so that page is the accurate source.",
    ar: "افتح **طلباتي** — تعرض كل طلبات مؤسستك مع حالته الحالية ورقم التقديم وتاريخ آخر تحديث، ويمكنك البحث أو الفلترة حسب الحالة. اضغط *فتح* على أي صف لعرض المسار الزمني الكامل والمستندات وأي إجراء مطلوب منك. لا يمكنني الاطلاع على تفاصيل طلب بعينه، لذا فتلك الصفحة هي المرجع الدقيق.",
  },
  {
    id: "request_states",
    keywords: ["what does the state mean", "request states", "status meanings", "under intake review", "assessment queued", "ماذا تعني الحالة", "حالات الطلب", "معاني الحالات", "مراجعة الاستلام", "بانتظار التقييم"],
    en: "The states run in order: **Draft** (not submitted yet) → **Submitted** → **Under intake review** (completeness check) → **Accepted** → **Assessment queued** / **Assessment running** → **Technical review** → **Decision** → **Report issued** → **Done**. Two states sit outside that line: **Returned to client** means we need corrections from you, and **On hold** means the request is paused. **Cancelled** means it was stopped and won't proceed.",
    ar: "تتسلسل الحالات كالتالي: **مسودة** (لم يُقدَّم بعد) ← **مُقدَّم** ← **مراجعة الاستلام** (فحص الاكتمال) ← **مقبول** ← **بانتظار التقييم** / **التقييم جارٍ** ← **المراجعة الفنية** ← **القرار** ← **صدر التقرير** ← **تم**. وهناك حالتان خارج هذا المسار: **مُعاد للعميل** أي أننا بحاجة إلى تصحيحات منك، و**معلّق** أي أن الطلب متوقف مؤقتاً. أما **ملغى** فتعني أن الطلب أُوقف ولن يستكمل.",
  },
  {
    id: "sla_timeline",
    keywords: ["how long does it take", "turnaround time", "sla", "when will it be ready", "processing time", "كم يستغرق", "مدة الإنجاز", "مستوى الخدمة", "متى يكون جاهزاً", "مدة المعالجة"],
    en: "Each service has its own published timeline, shown in the wizard before you submit and on the request page as a due date. The clock pauses whenever a request is returned to you for corrections or put on hold, and resumes when it moves forward again. You'll be notified if a request is at risk of missing its window.",
    ar: "لكل خدمة مدة إنجاز معلنة خاصة بها، تظهر في المعالج قبل التقديم وفي صفحة الطلب كتاريخ استحقاق. ويتوقف العدّاد كلما أُعيد الطلب إليك للتصحيح أو عُلّق، ويستأنف عند تقدّمه مجدداً. وسيصلك إشعار إذا أصبح الطلب مهدداً بتجاوز مدته.",
  },
  {
    id: "returned_to_client",
    keywords: ["returned for corrections", "returned to client", "request was returned", "fix and resubmit", "resubmit request", "resubmit", "مُعاد للعميل", "إعادة الطلب للتصحيح", "أُعيد طلبي", "تصحيح وإعادة تقديم", "إعادة تقديم الطلب"],
    en: "A returned request appears at the top of your Dashboard and shows a *Returned for corrections* banner explaining exactly what Atlas needs. Fix the flagged items on the request page — replace any document with **Replace file**, correct the product details if needed — add an optional note describing what you changed, and press **Resubmit request**.",
    ar: "يظهر الطلب المُعاد في أعلى لوحة التحكم مع شريط *أُعيد للتصحيح* يوضح بالضبط ما تحتاجه أطلس. صحّح البنود المؤشّر عليها في صفحة الطلب — استبدل أي مستند عبر **استبدال الملف**، وصحّح تفاصيل المنتج إن لزم — وأضف ملاحظة اختيارية تصف ما غيّرته، ثم اضغط **إعادة تقديم الطلب**.",
  },
  {
    id: "resubmit_limit",
    keywords: ["maximum resubmissions", "how many times can i resubmit", "resubmission limit", "الحد الأقصى لإعادة التقديم", "كم مرة يمكنني إعادة التقديم", "حد إعادة التقديم"],
    en: "There's a cap on how many times one request can be resubmitted. When it's reached, the Resubmit button is replaced by a note saying so — at that point contact Atlas through the **Support** page rather than starting over, so the history stays attached to the same request.",
    ar: "هناك حد أقصى لعدد مرات إعادة تقديم الطلب الواحد. وعند بلوغه يُستبدل زر إعادة التقديم بملاحظة توضح ذلك — وحينها تواصل مع أطلس عبر صفحة **الدعم** بدلاً من البدء من جديد، حتى يبقى سجل الطلب مرتبطاً بالطلب نفسه.",
  },
  {
    id: "messages",
    keywords: ["message atlas", "message", "reviewer", "send a message", "comments on a request", "talk to the reviewer", "مراسلة أطلس", "إرسال رسالة", "الرسائل على الطلب", "التواصل مع المراجع"],
    en: "Every request page has a **Messages** thread — write there and it goes to the Atlas staff handling that request, with the whole exchange kept on the request for reference. Use it for questions about that specific request; for account-wide or billing questions use the **Support** page.",
    ar: "تحتوي كل صفحة طلب على خيط **الرسائل** — اكتب فيه لتصل رسالتك إلى موظفي أطلس المسؤولين عن ذلك الطلب، مع حفظ المراسلات كاملة على الطلب للرجوع إليها. استخدمه للأسئلة المتعلقة بذلك الطلب تحديداً، أما الأسئلة العامة أو المالية فاستخدم صفحة **الدعم**.",
  },
  {
    id: "on_hold",
    keywords: ["on hold", "request paused", "why is my request on hold", "معلّق", "الطلب متوقف", "لماذا طلبي معلّق"],
    en: "**On hold** means Atlas has paused the request and its timeline clock — usually waiting on something external. The request page shows the reason. It resumes at exactly the stage it was paused from, so nothing already done is repeated.",
    ar: "تعني حالة **معلّق** أن أطلس أوقفت الطلب مؤقتاً وأوقفت معه عدّاد مدة الإنجاز — غالباً بانتظار أمر خارجي. وتوضح صفحة الطلب السبب. ويُستأنف الطلب من المرحلة نفسها التي عُلّق منها، فلا يُعاد أي عمل أُنجز.",
  },
  {
    id: "cancel_request",
    keywords: ["cancel my request", "cancelled request", "stop a request", "إلغاء طلبي", "طلب ملغى", "إيقاف الطلب"],
    en: "A submitted request is cancelled by Atlas, with a reason recorded on the request — ask through the **Messages** thread on that request or the **Support** page. Any open pro forma invoice for a cancelled request is voided. A draft you haven't submitted you can discard yourself.",
    ar: "يُلغى الطلب المُقدَّم من قِبل أطلس مع تسجيل السبب على الطلب — اطلب ذلك عبر خيط **الرسائل** في ذلك الطلب أو صفحة **الدعم**. وتُبطَل أي فاتورة مبدئية مفتوحة للطلب الملغى. أما المسودة التي لم تقدّمها فيمكنك تجاهلها بنفسك.",
  },
  {
    id: "edit_product_details",
    keywords: ["change product details", "edit my request", "correct a mistake", "mistake", "wrong product name", "update product information", "تعديل تفاصيل المنتج", "تعديل طلبي", "تصحيح خطأ", "تحديث بيانات المنتج"],
    en: "While a request is still early in the process, its page shows an **Update product details** panel where you can correct what you entered and save. Once it has moved further along, changes go through Atlas — raise it in the request's **Messages** thread.",
    ar: "ما دام الطلب في مراحله الأولى، تعرض صفحته لوحة **تحديث تفاصيل المنتج** حيث يمكنك تصحيح ما أدخلته وحفظه. وبعد تقدّمه في المسار تمر التعديلات عبر أطلس — اطرح الأمر في خيط **الرسائل** الخاص بالطلب.",
  },
  {
    id: "reopen_request",
    keywords: ["reopen a request", "reopen closed request", "request is closed but", "إعادة فتح الطلب", "إعادة فتح طلب مغلق"],
    en: "A closed or cancelled request page shows **Request reopening** — send that with your reason and Atlas either approves it (the request resumes at the appropriate stage) or explains why not. Use it when something needs correcting after closure rather than submitting a fresh request.",
    ar: "تعرض صفحة الطلب المغلق أو الملغى خيار **طلب إعادة الفتح** — أرسله مع سببك، فتوافق أطلس عليه (فيُستأنف الطلب من المرحلة المناسبة) أو توضح سبب الرفض. استخدمه عندما يحتاج أمر ما إلى تصحيح بعد الإغلاق بدلاً من تقديم طلب جديد.",
  },

  // ── Reports and certificates ──────────────────────────────────────────
  {
    id: "certificate_download",
    keywords: ["download certificate", "download report", "get my certificate", "where is my certificate", "تنزيل الشهادة", "الشهادة", "تحميل الشهادة", "تنزيل التقرير", "أين شهادتي"],
    en: "Once issued, the report or certificate is attached to its request — open the request from **My requests** and use **Download report PDF** or **Download certificate PDF**. Everything issued is also collected on the **Reports** page.",
    ar: "بمجرد الإصدار، يُرفَق التقرير أو الشهادة بطلبه — افتح الطلب من **طلباتي** واستخدم **تحميل تقرير PDF** أو **تحميل الشهادة PDF**. كما تُجمع كل الإصدارات في صفحة **التقارير**.",
  },
  {
    id: "reports_page",
    keywords: ["reports page", "all my reports", "past certificates", "reports this year", "صفحة التقارير", "كل تقاريري", "الشهادات السابقة", "تقارير هذا العام"],
    en: "The **Reports** page lists every issued and closed conformity report for your organisation, filtered by year, with the request number, product, issue date and state — each row offering a PDF download, a link to the request, and public verification.",
    ar: "تعرض صفحة **التقارير** كل تقارير المطابقة الصادرة والمغلقة لمؤسستك، مُفلترة حسب السنة، مع رقم الطلب والمنتج وتاريخ الإصدار والحالة — ويتيح كل صف تنزيل PDF ورابطاً إلى الطلب والتحقق العلني.",
  },
  {
    id: "verify_certificate",
    keywords: ["verify a certificate", "verification code", "qr code on the report", "check a report is genuine", "التحقق من الشهادة", "رمز التحقق", "رمز الاستجابة السريعة", "التأكد من صحة التقرير"],
    en: "Every issued report carries a verification code and QR code. Anyone — your customer, a regulator, a distributor — can enter that code on the public **Verify report** page on the Atlas site to confirm it's genuine and current, without needing a portal login. Use **Verify publicly** on the request or Reports page to open it.",
    ar: "يحمل كل تقرير صادر رمز تحقق ورمز استجابة سريعة. ويستطيع أي شخص — عميلك أو جهة تنظيمية أو موزّع — إدخال ذلك الرمز في صفحة **تحقق من التقرير** العلنية على موقع أطلس للتأكد من صحته وسريانه، دون الحاجة إلى حساب في البوابة. استخدم **تحقق علناً** في صفحة الطلب أو التقارير لفتحها.",
  },
  {
    id: "refused",
    keywords: ["certification refused", "my request was refused", "rejected certification", "failed the assessment", "رفض إصدار الشهادة", "رُفض طلبي", "رفض الشهادة", "لم يجتز التقييم"],
    en: "If certification is refused, the decision and its grounds are recorded on the request and you're notified. Read the reasons on the request page, and use its **Messages** thread if anything is unclear — once the underlying issue is corrected, a new request can be submitted for the reworked product.",
    ar: "إذا رُفض إصدار الشهادة، يُسجَّل القرار وأسبابه على الطلب ويصلك إشعار بذلك. اطّلع على الأسباب في صفحة الطلب، واستخدم خيط **الرسائل** فيها إن كان أي أمر غير واضح — وبعد معالجة السبب الجذري يمكن تقديم طلب جديد للمنتج بعد تعديله.",
  },

  // ── Money ─────────────────────────────────────────────────────────────
  {
    id: "payment_invoice",
    keywords: ["invoice", "pro forma invoice", "my invoices", "invoice not received", "فاتورة", "الفواتير المبدئية", "فواتيري", "لم تصلني الفاتورة"],
    en: "Pro forma invoices are raised once a request is priced and live under the **Pro forma invoices** tab on the **Statement** page, each with its status (Draft, Issued, Partially paid, Paid, Void), due date and a PDF download. You're notified whenever a new one is issued.",
    ar: "تُصدَر الفواتير المبدئية بعد تسعير الطلب وتوجد ضمن تبويب **الفواتير المبدئية** في صفحة **كشف الحساب**، ولكل منها حالتها (مسودة، صادرة، مدفوعة جزئياً، مدفوعة، مُبطَلة) وتاريخ استحقاقها ونسخة PDF للتنزيل. ويصلك إشعار عند إصدار أي فاتورة جديدة.",
  },
  {
    id: "how_to_pay",
    keywords: ["how do i pay", "payment method", "record a payment", "pay an invoice", "proof of payment", "طريقة الدفع", "كيف أدفع", "تسجيل دفعة", "سداد الفاتورة", "إثبات الدفع"],
    en: "Payment is settled outside the portal — there's no online card checkout. Pay by bank transfer, then log it under the **Record a payment** tab on the **Statement** page: enter the amount, method, the bank/transfer reference, and attach your proof of payment. Atlas finance confirms it, usually within one business day, and your balance updates then.",
    ar: "يتم السداد خارج البوابة — لا توجد بوابة دفع إلكتروني بالبطاقة. ادفع عبر التحويل البنكي، ثم سجّل الدفعة في تبويب **تسجيل دفعة** بصفحة **كشف الحساب**: أدخل المبلغ والطريقة ومرجع التحويل البنكي وأرفق إثبات الدفع. ويؤكدها فريق مالية أطلس عادةً خلال يوم عمل واحد، فيتحدّث رصيدك عندئذٍ.",
  },
  {
    id: "statement",
    keywords: ["statement of account", "my balance", "how much do i owe", "ledger", "aging", "كشف الحساب", "رصيدي", "كم المستحق علي", "دفتر القيود", "أعمار الديون"],
    en: "The **Statement** page shows your organisation's current balance, how it ages (current, 1–30, 31–60, 61–90, 90+ days), an append-only **Ledger** of every charge and payment with running balance and date filters, your pro forma invoices, and the payment-recording form. **Download statement (PDF)** exports the whole thing.",
    ar: "تعرض صفحة **كشف الحساب** رصيد مؤسستك الحالي وتوزيعه العمري (جاري، 1–30، 31–60، 61–90، أكثر من 90 يوماً)، و**دفتر قيود** غير قابل للتعديل يضم كل رسم ودفعة مع الرصيد المتحرك وفلاتر التاريخ، وفواتيرك المبدئية، ونموذج تسجيل الدفعات. ويصدّر زر **تحميل كشف الحساب (PDF)** كل ذلك.",
  },
  {
    id: "credit_limit",
    keywords: ["credit limit", "account on hold for payment", "overdue balance", "حد الائتمان", "إيقاف الحساب للسداد", "رصيد متأخر"],
    en: "Your organisation has a credit limit, and the Statement page shows how much of it is used. You're notified when the limit is reached and when a statement goes overdue — settle the outstanding pro forma invoices, or talk to Atlas finance through the **Support** page if you need the limit reviewed.",
    ar: "لمؤسستك حد ائتمان، وتوضح صفحة كشف الحساب النسبة المستخدمة منه. ويصلك إشعار عند بلوغ الحد وعند تأخر كشف الحساب — سدّد الفواتير المبدئية المستحقة، أو تواصل مع مالية أطلس عبر صفحة **الدعم** إذا أردت مراجعة الحد.",
  },
  {
    id: "pricing_vat",
    keywords: ["how much does it cost", "price includes vat", "pricing", "fees", "كم التكلفة", "هل السعر شامل الضريبة", "التسعير", "الرسوم"],
    en: "Each service has its own published price, quoted as the base fee plus VAT, and the wizard shows both the base and the VAT-inclusive total for the service you've selected before you submit — with any coupon applied. Tell me the service name and I'll give you its current price.",
    ar: "لكل خدمة سعرها المعلن الخاص بها، ويُعرض كأتعاب أساسية مضافاً إليها ضريبة القيمة المضافة، ويُظهر لك المعالج قبل التقديم كلاً من المبلغ الأساسي والإجمالي شامل الضريبة للخدمة التي اخترتها — بعد تطبيق أي قسيمة. أخبرني باسم الخدمة وسأعطيك سعرها الحالي.",
  },

  // ── Company, users and preferences ────────────────────────────────────
  {
    id: "company_profile",
    keywords: ["company profile", "cr number", "vat number", "company address", "change company details", "ملف الشركة", "السجل التجاري", "الرقم الضريبي", "عنوان الشركة", "تعديل بيانات الشركة"],
    en: "**Company profile → Identity, contact & address** holds the details that print on your regulatory reports and pro forma invoices — company name in English and Arabic, CR number, VAT number, contact details and address. Keep them print-ready, and note that nothing autosaves here: press **Save changes**.",
    ar: "يحتوي قسم **ملف الشركة ← الهوية والتواصل والعنوان** على البيانات التي تُطبع على تقاريرك التنظيمية وفواتيرك المبدئية — اسم الشركة بالعربية والإنجليزية، ورقم السجل التجاري، والرقم الضريبي، وبيانات التواصل والعنوان. احرص على أن تكون جاهزة للطباعة، وانتبه إلى أن لا شيء يُحفظ تلقائياً هنا: اضغط **حفظ التغييرات**.",
  },
  {
    id: "company_users",
    keywords: ["invite a user", "invite", "add a colleague", "manage users", "deactivate a user", "دعوة مستخدم", "إضافة زميل", "إدارة المستخدمين", "تعطيل مستخدم"],
    en: "The **Users** tab in Company profile lists everyone in your organisation with their role, status and last login. Owners and admins can **Invite user** — the new user is emailed their credentials — change someone's role, or deactivate an account that should no longer have access.",
    ar: "يعرض تبويب **المستخدمون** في ملف الشركة كل أفراد مؤسستك مع أدوارهم وحالتهم وآخر دخول لهم. ويمكن للمالك والمشرف **دعوة مستخدم** — فتُرسل بيانات الدخول إلى المستخدم الجديد عبر البريد — أو تغيير دور أحدهم أو تعطيل حساب لم يعد ينبغي أن يملك صلاحية الوصول.",
  },
  {
    id: "client_roles",
    keywords: ["user roles", "what can each role do", "permissions", "owner admin finance", "أدوار المستخدمين", "ماذا يستطيع كل دور", "الصلاحيات", "المالك المشرف المالية"],
    en: "There are four roles: **Owner** manages billing and users; **Admin** manages users and company settings; **Requests** creates and tracks requests; **Finance** sees pro forma invoices and the statement only. If a page says access denied, ask your organisation's owner to adjust your role.",
    ar: "هناك أربعة أدوار: **المالك** يدير الفوترة والمستخدمين؛ و**المشرف** يدير المستخدمين وإعدادات الشركة؛ و**الطلبات** ينشئ الطلبات ويتابعها؛ و**المالية** ترى الفواتير المبدئية وكشف الحساب فقط. وإذا ظهرت لك رسالة رفض وصول لصفحة ما، فاطلب من مالك مؤسستك تعديل دورك.",
  },
  {
    id: "gov_credentials",
    keywords: ["saber account", "ghad account", "fasah account", "government portal login", "platform credentials", "حساب سابر", "حساب غد", "حساب فسح", "حسابات المنصات الحكومية"],
    en: "**Company profile → Government portal accounts** stores your GHAD, SABER and FASAH logins so they can be reused across requests instead of retyping them. They're stored encrypted, Atlas staff can use them to submit on your behalf, and every use is logged. Add one there before starting a request whose service asks for that account.",
    ar: "يحفظ قسم **ملف الشركة ← حسابات المنصات الحكومية** بيانات دخولك إلى غد وسابر وفسح لإعادة استخدامها عبر الطلبات بدل إعادة كتابتها في كل مرة. وتُخزَّن مشفّرة، ويمكن لموظفي أطلس استخدامها للتقديم نيابةً عنك، ويُسجَّل كل استخدام لها. أضف الحساب هناك قبل بدء طلب تتطلب خدمته ذلك الحساب.",
  },
  {
    id: "notification_preferences",
    keywords: ["notification settings", "turn off emails", "email preferences", "stop notifications", "إعدادات الإشعارات", "إيقاف رسائل البريد", "تفضيلات البريد", "إيقاف الإشعارات"],
    en: "**Company profile → Preferences** controls which events notify you and whether by email, in-app, or both — request received, returned, report issued, certification refused, closed, SLA at risk, invoice issued, payment received or rejected, statement overdue, credit limit reached. Legal and financial notices stay on so invoice and statement events are never missed.",
    ar: "يتحكم قسم **ملف الشركة ← التفضيلات** في الأحداث التي تُشعرك وطريقة الإشعار: بالبريد أو داخل التطبيق أو كليهما — استلام الطلب، وإعادته، وصدور التقرير، ورفض إصدار الشهادة، والإغلاق، وتنبيه مستوى الخدمة، وإصدار فاتورة مبدئية، واستلام دفعة أو رفضها، وتأخر كشف الحساب، وبلوغ حد الائتمان. وتبقى الإشعارات القانونية والمالية مفعّلة دائماً حتى لا تفوتك أحداث الفواتير وكشف الحساب.",
  },
  {
    id: "notifications",
    keywords: ["notifications page", "alerts", "bell icon", "unread notifications", "صفحة الإشعارات", "التنبيهات", "أيقونة الجرس", "إشعارات غير مقروءة"],
    en: "The bell icon in the top bar and the **Notifications** page hold your alerts — every stage change on your requests, documents requested, invoices issued, and so on. Clicking one takes you straight to the request it concerns.",
    ar: "تحتوي أيقونة الجرس في الشريط العلوي وصفحة **الإشعارات** على تنبيهاتك — كل تغيّر في مراحل طلباتك، وطلبات المستندات، وإصدار الفواتير، وغيرها. والضغط على أي تنبيه ينقلك مباشرةً إلى الطلب المعني.",
  },
  {
    id: "language",
    keywords: ["change language", "arabic interface", "switch to english", "تغيير اللغة", "الواجهة العربية", "التبديل إلى الإنجليزية", "لغة الواجهة"],
    en: "The portal runs fully in Arabic and English, including right-to-left layout in Arabic. Set your interface language under **Company profile → Preferences**, or use the language switch in the top bar. I'll reply in whichever language you write to me in.",
    ar: "تعمل البوابة بالكامل بالعربية والإنجليزية، بما في ذلك تخطيط الواجهة من اليمين إلى اليسار في العربية. حدّد لغة الواجهة من **ملف الشركة ← التفضيلات**، أو استخدم مبدّل اللغة في الشريط العلوي. وسأجيبك باللغة التي تكتب بها إليّ.",
  },
  {
    id: "account_access",
    keywords: ["cannot sign in", "sign in", "log in", "password", "forgot my password", "reset password", "access denied", "locked out", "لا أستطيع تسجيل الدخول", "نسيت كلمة المرور", "إعادة تعيين كلمة المرور", "رفض الوصول"],
    en: "If a page says access denied, your role doesn't include it — your organisation's owner or admin can change that from **Company profile → Users**. For sign-in trouble or a forgotten password, your owner/admin can reissue access from the same tab, or contact Atlas through the **Support** page.",
    ar: "إذا ظهرت رسالة رفض الوصول لصفحة ما، فذلك لأن دورك لا يشملها — ويمكن لمالك مؤسستك أو مشرفها تغيير ذلك من **ملف الشركة ← المستخدمون**. أما مشكلات تسجيل الدخول أو نسيان كلمة المرور فيمكن للمالك أو المشرف إعادة منح الوصول من التبويب نفسه، أو تواصل مع أطلس عبر صفحة **الدعم**.",
  },

  // ── How assessment works ──────────────────────────────────────────────
  {
    id: "how_assessment_works",
    keywords: ["how does assessment work", "how does evaluation work", "assessment process", "evaluation process", "how do you check my product", "آلية التقييم", "كيف يتم التقييم", "عملية التقييم", "كيف تفحصون منتجي"],
    en: "In general: your documents are collected, checked clause-by-clause against the applicable Saudi standard (SFDA, GSO or SASO), reviewed by a technical reviewer, and a decision is issued. Some services also involve inspection, lab testing, or a factory audit — the service page tells you which. The final determination is always made by Atlas's evaluators.",
    ar: "بشكل عام: تُجمع مستنداتك وتُراجَع بنداً ببند وفق المعيار السعودي المعني (الهيئة العامة للغذاء والدواء أو هيئة التقييس الخليجية أو الهيئة السعودية للمواصفات)، ثم يراجعها مُقيّم فني، ويصدر القرار. وتتضمن بعض الخدمات أيضاً تفتيشاً أو اختباراً مخبرياً أو تدقيق مصنع — وتوضح صفحة الخدمة ذلك. والقرار النهائي يصدر دائماً عن مقيّمي أطلس.",
  },
  {
    id: "lab_testing",
    keywords: ["lab testing", "laboratory test", "send samples", "test report", "الاختبار المخبري", "الفحص المخبري", "إرسال العينات", "تقرير الاختبار"],
    en: "Where a service includes laboratory testing, Atlas identifies the tests your product needs, selects the laboratory, and arranges sample handling — you'll be told what to send and where. The results feed into the evaluation before any decision is made. Whether a given service includes testing is listed among its evaluation activities in the wizard.",
    ar: "عندما تتضمن الخدمة اختباراً مخبرياً، تُحدد أطلس الفحوصات التي يحتاجها منتجك وتختار المختبر وتنظّم التعامل مع العينات — وسيُوضَّح لك ما ترسله وإلى أين. وتُدرج النتائج في التقييم قبل إصدار أي قرار. ويظهر ما إذا كانت الخدمة تتضمن اختباراً ضمن أنشطة تقييمها في المعالج.",
  },
  {
    id: "inspection_audit",
    keywords: ["inspection", "factory audit", "site visit", "التفتيش", "تدقيق المصنع", "زيارة الموقع"],
    en: "Some services include an inspection or a factory audit as an evaluation activity — Atlas coordinates the visit with you and its findings go into the evaluation. The wizard lists which activities a service involves before you submit, so you know upfront whether a visit is part of it.",
    ar: "تتضمن بعض الخدمات تفتيشاً أو تدقيق مصنع ضمن أنشطة التقييم — وتنسّق أطلس الزيارة معك، وتُدرَج نتائجها في التقييم. ويعرض المعالج الأنشطة التي تتضمنها الخدمة قبل التقديم، فتعرف مسبقاً ما إذا كانت الزيارة جزءاً منها.",
  },
  {
    id: "label_check",
    keywords: ["label check", "artwork review", "labelling requirements", "what must the label show", "فحص البطاقة", "مراجعة التصميم", "متطلبات البطاقة", "ماذا يجب أن تتضمن البطاقة"],
    en: "Label and artwork assessment checks your artwork against the labelling standard that applies to the product — the mandatory particulars, their language, and any required warnings or restrictions. Ask me about a specific requirement (for example net weight declaration or a warning statement) and I'll quote what's on file for it in the active knowledge base.",
    ar: "يقارن تقييم البطاقة والتصميم تصميمك بمعيار وضع البطاقات المنطبق على المنتج — البيانات الإلزامية ولغتها وأي تحذيرات أو قيود مطلوبة. اسألني عن متطلب بعينه (مثل بيان الوزن الصافي أو عبارة تحذيرية) وسأقتبس لك ما هو مسجّل بشأنه في قاعدة المعرفة الفعّالة.",
  },
  {
    id: "privacy_data",
    keywords: ["is my data safe", "who can see my documents", "confidential", "data privacy", "هل بياناتي آمنة", "من يرى مستنداتي", "سرية", "خصوصية البيانات"],
    en: "Your requests, documents and company data are visible only to users in your own organisation and to the Atlas staff handling your requests — never to another client. Government portal passwords are stored encrypted and every use of them is logged. For a formal confidentiality query, contact Atlas through the **Support** page.",
    ar: "طلباتك ومستنداتك وبيانات شركتك مرئية فقط لمستخدمي مؤسستك ولموظفي أطلس المسؤولين عن طلباتك — ولا تظهر لأي عميل آخر أبداً. وتُخزَّن كلمات مرور المنصات الحكومية مشفّرة ويُسجَّل كل استخدام لها. ولأي استفسار رسمي بشأن السرية، تواصل مع أطلس عبر صفحة **الدعم**.",
  },

  // ── Getting a human ───────────────────────────────────────────────────
  {
    id: "contact_support",
    keywords: ["contact support", "talk to someone", "speak to an agent", "human agent", "phone number", "working hours", "تواصل مع الدعم", "التحدث مع شخص", "الدعم الفني", "ساعات العمل", "رقم الهاتف"],
    en: "The **Support** page has Atlas's contact details and an email link, and lists the working hours (Sunday–Thursday, 09:00–17:00 Arabia Standard Time). For anything tied to one request, the **Messages** thread on that request reaches the staff already handling it, which is usually faster.",
    ar: "تحتوي صفحة **الدعم** على بيانات التواصل مع أطلس ورابط للمراسلة بالبريد، وتوضح ساعات العمل (الأحد–الخميس، 09:00–17:00 بتوقيت السعودية). وبالنسبة لأي أمر مرتبط بطلب بعينه، يصل خيط **الرسائل** في ذلك الطلب إلى الموظفين المسؤولين عنه بالفعل، وهو أسرع عادةً.",
  },
];

/** Regulatory-scheme codes like "SAB-001" or "LAB-001" — always treated as a specific-service mention. */
const SERVICE_CODE_PATTERN = /\b[a-z]{2,6}-\d{2,4}\b/i;

const SERVICE_SIGNAL_WORDS = [
  "sfda", "gso", "saso", "saber", "pcoc", "scoc", "cosmetic", "supplement", "laboratory",
  "lab test", "factory audit", "fragrance", "perfume", "medical device",
  "مستحضرات", "التجميل", "مكملات", "المكملات", "المختبر", "تدقيق المصنع", "الأغذية", "الأدوية",
];

/**
 * A message naming a specific service/code/regulatory scheme is better served
 * by the model with the whole catalogue in front of it than by a generic
 * process answer — but only while the model is actually reachable. The
 * caller passes `deferSpecificServiceToAi` accordingly; see the module doc.
 */
function mentionsSpecificService(text: string): boolean {
  const normalized = text.toLowerCase();
  return SERVICE_CODE_PATTERN.test(normalized) || SERVICE_SIGNAL_WORDS.some((w) => normalized.includes(w));
}

/**
 * Returns a stored answer on a clear match. Scoring and tie-handling live in
 * keyword-match.ts — a tie defers to the fallback rather than guessing which
 * of two topics was meant.
 */
export function matchCannedAnswer(
  text: string,
  options: { deferSpecificServiceToAi?: boolean } = {},
): CannedAnswer | null {
  if (options.deferSpecificServiceToAi && mentionsSpecificService(text)) return null;

  const entry = bestMatch(CANNED_ANSWERS, text);
  return entry ? { en: entry.en, ar: entry.ar } : null;
}

/** The topics offered when nothing matched and there's no near-miss to suggest. */
const HEADLINE_TOPIC_IDS = ["new_request", "check_status", "upload_documents", "payment_invoice", "certificate_download", "contact_support"];

/**
 * The reply for a message no stored answer resolved. With the AI fallback
 * off this is the last word rather than a stepping stone, so it does the two
 * things a dead-end "unavailable" couldn't: name the topics closest to what
 * was actually asked, and point at the page that can answer for certain.
 */
export function buildFallbackReply(text: string, locale: string): string {
  const near = suggestEntries(CANNED_ANSWERS, text, 5);
  const entries = near.length > 0 ? near : CANNED_ANSWERS.filter((e) => HEADLINE_TOPIC_IDS.includes(e.id));
  const topics = entries.map((entry) => `- ${topicLabel(entry, locale)}`).join("\n");

  return locale === "ar"
    ? `ليست لديّ إجابة محفوظة لهذا السؤال تحديداً. يمكنني المساعدة في المواضيع التالية — اسألني عن أيٍّ منها:\n\n${topics}\n\nويمكنني أيضاً بيان متطلبات أي خدمة في الكتالوج (مستنداتها وسعرها ومدة إنجازها) إن ذكرت اسمها، أو ما ينص عليه بند تنظيمي مسجّل لدينا. ولأي أمر خارج ذلك — أو أي استفسار عن طلب بعينه — يرجى التواصل عبر صفحة **الدعم**.`
    : `I don't have a stored answer for that one. Here's what I can help with — ask me about any of these:\n\n${topics}\n\nI can also give you any catalogue service's requirements (documents, price and timeline) if you name it, or what a regulatory clause on file says. For anything beyond that — or any question about a specific request — please use the **Support** page.`;
}

/** Test seam: the matched topic's id, so coverage tests can assert routing without exporting the bank. */
export function matchCannedTopicId(text: string, options: { deferSpecificServiceToAi?: boolean } = {}): string | null {
  if (options.deferSpecificServiceToAi && mentionsSpecificService(text)) return null;
  return bestMatch(CANNED_ANSWERS, text)?.id ?? null;
}
