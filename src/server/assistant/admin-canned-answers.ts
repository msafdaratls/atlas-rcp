import type { Role } from "@prisma/client";
import {
  bestMatch,
  suggestEntries,
  topicLabel,
  type KeywordEntry,
} from "@/server/assistant/keyword-match";

/**
 * Static Q&A shortcuts for the admin/staff assistant chat — the bilingual
 * counterpart to admin-manual-context.ts's English-only AI-grounding text.
 * Matched entries answer the turn directly: no Claude call, no tokens
 * spent. Each entry may carry `roles` (same shape as app-sidebar.tsx's
 * NavItem.roles) to restrict it to the staff who'd actually see that page;
 * omitted means visible to every Atlas staff role.
 */
export type CannedAnswer = { en: string; ar: string };

type CannedEntry = CannedAnswer & KeywordEntry & { roles?: Role[] };

const CANNED_ANSWERS: CannedEntry[] = [
  // ── All staff ─────────────────────────────────────────────────────────
  {
    id: "dashboard",
    keywords: ["dashboard", "queue depth", "sla at risk", "لوحة التحكم", "لوحة القيادة"],
    en: "The **Dashboard** (your admin home page) shows queue-depth tiles for each stage with an SLA-at-risk count, a 30-day received-vs-closed chart, and the top return reasons from the last 90 days. Finance figures are only shown to Finance and System Admin. Click any queue tile to jump to that stage's filtered **Requests** list.",
    ar: "تعرض **لوحة التحكم** (الصفحة الرئيسية للإدارة) بطاقات لعمق كل قائمة انتظار مع عدد الطلبات المهددة بتجاوز مدة الإنجاز، ورسمًا بيانيًا لآخر 30 يومًا للطلبات المستلمة مقابل المغلقة، وأكثر أسباب الإعادة تكرارًا خلال آخر 90 يومًا. تظهر أرقام المالية فقط لدوري المالية ومدير النظام. اضغط على أي بطاقة قائمة انتظار للانتقال إلى صفحة **الطلبات** مُفلترة لتلك المرحلة.",
  },
  {
    id: "work_queues",
    keywords: ["work queue", "queues page", "pick up work", "قائمة الانتظار", "طوابير العمل"],
    en: "The **Work Queues** page shows six count tiles — Intake, Assessment, Technical review, Decision, Returned, On hold. Clicking one navigates to the **Requests** list filtered to that group. There's no separate \"claim\" button — open a request from the list and either use its stage action (which auto-assigns you if it's unassigned) or the explicit **Assign** control on the request page.",
    ar: "تعرض صفحة **طوابير العمل** ست بطاقات عدّ: الاستلام، التقييم، المراجعة الفنية، القرار، المُعاد، والمُعلّق. الضغط على إحداها ينقلك إلى صفحة **الطلبات** مُفلترة لتلك المجموعة. لا يوجد زر \"استلام\" منفصل — افتح الطلب من القائمة واستخدم إجراء مرحلته (الذي يُسندك تلقائيًا إذا كان الطلب غير مُسند) أو أداة **الإسناد** الصريحة في صفحة الطلب.",
  },
  {
    id: "requests_search",
    keywords: ["find a request", "search requests", "filter requests", "requests list", "البحث عن طلب", "قائمة الطلبات"],
    en: "The **Requests** page lists every request with search and filters (state, queue, free text) plus each request's SLA due date and an unread-client-message flag. Click **Open** on a row to reach its detail page, where all the real actions live.",
    ar: "تعرض صفحة **الطلبات** جميع الطلبات مع خيارات بحث وفلترة (الحالة، قائمة الانتظار، نص حر)، إضافة إلى موعد استحقاق مدة الإنجاز وعلامة رسالة عميل غير مقروءة لكل طلب. اضغط **فتح** على أي صف للوصول إلى صفحة تفاصيله، حيث توجد كل الإجراءات الفعلية.",
  },
  {
    id: "assign_request",
    keywords: ["assign a request", "assignee", "reassign", "إسناد طلب", "تعيين طلب"],
    en: "On a request's detail page, use the **Assign** control to hand it to a specific colleague. The picker defaults to the role that normally owns the request's current stage but falls back to the full staff list if no one holds that role. Several stage actions (like Intake's \"Complete Application Review\") also auto-assign you if the request is currently unassigned.",
    ar: "في صفحة تفاصيل الطلب، استخدم أداة **الإسناد** لتحويله إلى زميل محدد. تُفلتر القائمة افتراضيًا حسب الدور الذي يمتلك مرحلة الطلب الحالية عادةً، وتعود لعرض كل الموظفين إذا لم يوجد أحد بهذا الدور. بعض إجراءات المرحلة (مثل \"إكمال مراجعة الطلب\" في الاستلام) تُسندك تلقائيًا إذا كان الطلب غير مُسند.",
  },
  {
    id: "documents_search",
    keywords: ["find a document", "search documents", "documents page", "البحث عن مستند", "صفحة المستندات"],
    en: "The **Documents** page is a system-wide, read-only search across every uploaded file on every request (labels, certificates, reports) — searchable and filterable by file type. Click a request number in the results to jump to that request's detail page.",
    ar: "صفحة **المستندات** هي أداة بحث للقراءة فقط تغطي جميع الملفات المرفوعة في كل الطلبات (بطاقات البيان، الشهادات، التقارير) — قابلة للبحث والفلترة حسب نوع الملف. اضغط على رقم الطلب في النتائج للانتقال إلى صفحة تفاصيله.",
  },
  {
    id: "notifications_admin",
    keywords: ["notifications", "notification inbox", "الإشعارات", "صندوق الإشعارات"],
    en: "Your **Notifications** page is a personal inbox for your own alerts — assignments, state changes, and so on. Clicking a notification takes you straight to the relevant request.",
    ar: "صفحة **الإشعارات** الخاصة بك هي صندوق شخصي لتنبيهاتك — الإسناد، تغييرات الحالة، وغيرها. الضغط على أي إشعار ينقلك مباشرة إلى الطلب المعني.",
  },
  {
    id: "engagements",
    keywords: ["engagement", "retainer", "account management service", "الارتباطات", "اتفاقية الحساب"],
    en: "**Engagements** track an ongoing relationship with a client (e.g. an Account Management service) that spawns many requests over time. Use **Create Engagement** to start one, and **New Request** on an engagement's detail page to start a new on-behalf request already linked to it. **Close** ends the engagement.",
    ar: "تتبّع **الارتباطات** علاقة مستمرة مع عميل (مثل خدمة إدارة الحساب) تُنشئ طلبات متعددة عبر الوقت. استخدم **إنشاء ارتباط** لبدء واحد، وزر **طلب جديد** في صفحة تفاصيل الارتباط لبدء طلب نيابةً عن العميل مرتبط به تلقائيًا. **إغلاق** ينهي الارتباط.",
  },
  {
    id: "hold_resume",
    keywords: ["put on hold", "resume request", "on hold", "إيقاف مؤقت", "تعليق الطلب", "أعلق الطلب", "معلّق", "استئناف الطلب"],
    en: "Any of the four process roles (Intake Officer, Evaluator, Technical Reviewer, Decision Maker) or System Admin can **Put on hold** a request from most active states — this pauses its SLA clock. **Resume** always returns it to the exact state it was held from, never a different one.",
    ar: "يمكن لأي من الأدوار الأربعة (مسؤول الاستلام، المُقيّم، المُراجع الفني، صاحب القرار) أو مدير النظام **تعليق** الطلب مؤقتًا من معظم الحالات النشطة — يُوقف هذا عداد مدة الإنجاز. **الاستئناف** يُعيد الطلب دائمًا إلى نفس الحالة التي أُوقف منها، وليس إلى حالة أخرى.",
  },
  {
    id: "cancel_request",
    keywords: ["cancel a request", "cancel request", "إلغاء الطلب", "إلغاء طلب"],
    en: "**Cancel** is available from most active states to the four process roles and System Admin, and requires a note explaining why. A cancelled request moves to Cancelled and any open invoice for it is voided.",
    ar: "يتوفر خيار **الإلغاء** من معظم الحالات النشطة للأدوار الأربعة ومدير النظام، ويتطلب كتابة ملاحظة توضح السبب. ينتقل الطلب الملغى إلى حالة \"ملغى\" ويتم إبطال أي فاتورة مفتوحة له.",
  },
  {
    id: "coi_gate",
    keywords: ["conflict of interest", "coi checkbox", "coi acknowledgement", "تضارب المصالح", "إقرار تضارب"],
    en: "A **Conflict-of-Interest** checkbox appears before four actions: Complete Evaluation, Complete Testing, Complete Technical Review, and Refuse Certification. You must confirm it — declaring you have no conflicting interest in this client's outcome — before the action proceeds.",
    ar: "يظهر مربع إقرار **تضارب المصالح** قبل أربعة إجراءات: إكمال التقييم، إكمال الاختبار المخبري، إكمال المراجعة الفنية، ورفض الشهادة. يجب تأكيده — بالإقرار بعدم وجود تضارب مصالح لديك في نتيجة هذا العميل — قبل تنفيذ الإجراء.",
  },
  {
    id: "reopen_request",
    keywords: ["reopen a request", "reopen closed", "إعادة فتح الطلب", "إعادة فتح طلب"],
    en: "A client can ask to reopen a Closed or Cancelled request; staff then **Approve** it (picking which state it resumes into) or **Reject** it from the request detail page. Any staff member with access to that request (or System Admin) can also force a direct reopen with a reason, without waiting on a client request.",
    ar: "يمكن للعميل طلب إعادة فتح طلب \"تم\" أو \"ملغى\"؛ يقوم الموظف بعدها بـ**الموافقة** عليه (باختيار الحالة التي يعود إليها) أو **رفضه** من صفحة تفاصيل الطلب. يمكن أيضًا لأي موظف لديه صلاحية على ذلك الطلب (أو مدير النظام) فرض إعادة فتح مباشرة مع ذكر السبب، دون انتظار طلب من العميل.",
  },

  // ── Intake Officer ────────────────────────────────────────────────────
  {
    id: "intake_review",
    roles: ["INTAKE_OFFICER", "SYSTEM_ADMIN"],
    keywords: ["review a submitted request", "under intake review", "intake review", "مراجعة الاستلام", "قيد مراجعة الاستلام"],
    en: "When a new request arrives (state Submitted), move it to **Under intake review** to start checking it. From there, either **Return to Client** if something's missing, or click **Complete Application Review** once it's in order.",
    ar: "عند وصول طلب جديد (حالة \"مُقدَّم\")، انقله إلى **مراجعة الاستلام** لتبدأ فحصه. من هناك، إمّا **إعادته للعميل** إذا كان ناقصًا، أو الضغط على **إكمال مراجعة الطلب** بمجرد اكتماله.",
  },
  {
    id: "complete_application_review",
    roles: ["INTAKE_OFFICER", "SYSTEM_ADMIN"],
    keywords: ["complete application review", "إكمال مراجعة الطلب"],
    en: "**Complete Application Review** is a one-click action that cascades the request through Accepted, Queued, and into Assessment Running in a single step, and automatically assigns it to that service's configured default Evaluator. The client is notified their request was accepted.",
    ar: "**إكمال مراجعة الطلب** إجراء بضغطة واحدة ينقل الطلب عبر \"مقبول\" و\"بانتظار التقييم\" وصولًا إلى \"التقييم جارٍ\" في خطوة واحدة، ويُسنده تلقائيًا إلى المُقيّم الافتراضي المحدد لتلك الخدمة. يصل للعميل إشعار بقبول طلبه.",
  },
  {
    id: "return_to_client",
    keywords: ["return to client", "return reason", "fault attribution", "إعادة الطلب للعميل", "سبب الإعادة"],
    en: "**Return to Client** is available to Intake Officer, Evaluator, Technical Reviewer, Decision Maker, and System Admin from most active states. The dialog requires at least one return reason code plus a fault attribution (Client / Atlas / Regulatory) and a note — the request moves to Returned to client and the client is notified to fix and resubmit.",
    ar: "خيار **إعادة الطلب للعميل** متاح لمسؤول الاستلام، المُقيّم، المُراجع الفني، صاحب القرار، ومدير النظام من معظم الحالات النشطة. يتطلب مربع الحوار اختيار سبب إعادة واحد على الأقل، مع تحديد الجهة المسؤولة (العميل / أطلس / تنظيمي) وكتابة ملاحظة — ينتقل الطلب إلى حالة \"مُعاد للعميل\" ويصل للعميل إشعار لتصحيحه وإعادة تقديمه.",
  },
  {
    id: "create_client",
    roles: ["INTAKE_OFFICER", "SYSTEM_ADMIN"],
    keywords: ["create a client", "add a new client", "create client", "إنشاء عميل", "إضافة عميل جديد"],
    en: "From the **Clients** page, click **Create Client** to set up a new client organisation — company name in English and Arabic, plus the owner's email, phone, and password. The account is created active and pre-verified, ready to submit requests immediately.",
    ar: "من صفحة **العملاء**، اضغط **إنشاء عميل** لإعداد منشأة عميل جديدة — اسم الشركة بالعربية والإنجليزية، مع بريد المالك وهاتفه وكلمة المرور. يُنشأ الحساب فعّالًا ومُوثّقًا مسبقًا، وجاهزًا لتقديم الطلبات فورًا.",
  },
  {
    id: "new_request_on_behalf",
    roles: ["INTAKE_OFFICER", "SYSTEM_ADMIN"],
    keywords: ["request on behalf", "submit on behalf", "new request for a client", "تقديم طلب نيابة", "طلب نيابة عن العميل"],
    en: "Click **New Request** from the Requests list, a client's detail page, or an Engagement's detail page to start a request on a client's behalf. It pins the acting client, then walks the same multi-step wizard clients use themselves. The request enters the normal lifecycle at Submitted, landing in the Intake queue.",
    ar: "اضغط **طلب جديد** من قائمة الطلبات، أو صفحة تفاصيل عميل، أو صفحة تفاصيل ارتباط، لبدء طلب نيابةً عن عميل. يُثبّت هذا العميل الفاعل، ثم يرشدك عبر نفس معالج الخطوات المتعددة الذي يستخدمه العملاء أنفسهم. يدخل الطلب دورة الحياة العادية بحالة \"مُقدَّم\"، ليصل إلى قائمة انتظار الاستلام.",
  },

  // ── Evaluator ─────────────────────────────────────────────────────────
  {
    id: "assessment_panel",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    keywords: ["assessment panel", "compliance checklist", "لوحة التقييم", "قائمة المطابقة"],
    en: "The **Assessment panel** on a request in Assessment Running is where you mark each service item's compliance checklist — Compliant / Non-Compliant / N-A per check item. This is the same checklist the Label Evaluator's \"Promote to Official Checklist\" writes into when used.",
    ar: "**لوحة التقييم** في الطلب أثناء \"التقييم جارٍ\" هي حيث تُحدد حالة كل بند في قائمة المطابقة — مطابق / غير مطابق / لا ينطبق لكل عنصر فحص. هذه هي نفس القائمة التي يكتب فيها زر \"ترحيل إلى القائمة الرسمية\" في مُقيّم البطاقات عند استخدامه.",
  },
  {
    id: "evaluation_activities",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    keywords: ["lab testing steps", "record sample shipment", "select laboratory", "evaluation activities", "أنشطة التقييم", "إرسال العينة", "اختيار المختبر"],
    en: "For lab testing, the sequence in the **Evaluation Activities** panel is: add the required tests -> select a laboratory -> record the sample shipment -> confirm the sample was received -> upload the lab's report -> mark the activity Complete (this last step requires at least one uploaded report). For inspection or factory audit, schedule a date and inspector, then mark it complete.",
    ar: "بالنسبة للاختبار المخبري، التسلسل في لوحة **أنشطة التقييم** هو: إضافة الاختبارات المطلوبة ← اختيار مختبر ← تسجيل شحن العينة ← تأكيد استلام العينة ← رفع تقرير المختبر ← تحديد النشاط كـ\"مكتمل\" (تتطلب هذه الخطوة الأخيرة رفع تقرير واحد على الأقل). أمّا للتفتيش أو تدقيق المصنع، فحدد موعدًا ومفتشًا، ثم علّمه كمكتمل.",
  },
  {
    id: "complete_testing",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    keywords: ["complete testing", "lab testing coordination", "lab-001", "إكمال الاختبار المخبري", "إكمال الاختبار"],
    en: "For a request made up entirely of Lab Testing Coordination (LAB-001) items, once every item's lab-testing activity is Complete, the **Complete Testing** button appears. One click cascades the request straight to Report issued and then Closed — skipping Technical Review and Decision entirely.",
    ar: "للطلب المكوّن بالكامل من بنود \"تنسيق الاختبارات المخبرية\" (LAB-001)، بمجرد اكتمال نشاط الاختبار المخبري لكل بند، يظهر زر **إكمال الاختبار**. تنقل هذه الضغطة الطلب مباشرة إلى \"صدر التقرير\" ثم \"تم\" — متجاوزةً المراجعة الفنية والقرار تمامًا.",
  },
  {
    id: "evaluation_report",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    keywords: ["evaluation report upload", "upload evaluation report", "رفع تقرير التقييم", "تقرير التقييم"],
    en: "Before you can advance a request out of Assessment Running, an **Evaluation Report** document must be uploaded per required item — do this in the Evaluation Report panel. Trying to advance without it is blocked with an error naming which item is missing its report.",
    ar: "قبل أن تتمكن من نقل الطلب خارج \"التقييم جارٍ\"، يجب رفع مستند **تقرير التقييم** لكل بند مطلوب — نفّذ ذلك من لوحة تقرير التقييم. محاولة التقدّم دون ذلك تُحجب برسالة خطأ تحدد البند الناقص لتقريره.",
  },
  {
    id: "complete_evaluation",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    keywords: ["complete evaluation", "advance to technical review", "إكمال التقييم", "التقدم للمراجعة الفنية"],
    en: "**Complete Evaluation** (after confirming the Conflict-of-Interest checkbox) moves a normal request to Technical Review. For a request made entirely of SCOC-type items, the same button skips Technical Review and moves it straight to Decision instead.",
    ar: "**إكمال التقييم** (بعد تأكيد مربع إقرار تضارب المصالح) ينقل الطلب العادي إلى المراجعة الفنية. أمّا للطلب المكوّن بالكامل من بنود من نوع SCOC، فنفس الزر يتخطى المراجعة الفنية وينقله مباشرة إلى القرار.",
  },
  {
    id: "label_evaluator_ai",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    keywords: ["label evaluator", "promote to official checklist", "ai label", "مُقيّم البطاقات", "ترحيل القائمة الرسمية"],
    en: "The **Label Evaluator** (SFDA Supplements / Cosmetics) is an AI-assisted tool inside your normal assessment step. **Start Evaluation** extracts label fields from the uploaded artwork; you confirm or edit each field, reclassify the category if needed, then **Confirm & Run Assessment** proposes a verdict per rule, which you **Confirm** or **Override**. Nothing is official until you do — the AI only proposes. **Promote to Official Checklist** then writes your confirmed verdicts into the request's real Assessment panel.",
    ar: "**مُقيّم البطاقات** (مكملات SFDA / مستحضرات التجميل) أداة مدعومة بالذكاء الاصطناعي ضمن خطوة التقييم المعتادة لديك. **بدء التقييم** يستخرج حقول البطاقة من التصميم المرفوع؛ تُؤكد أو تُعدّل كل حقل، وتُعيد تصنيف الفئة إن لزم، ثم **تأكيد وتشغيل التقييم** يقترح حكمًا لكل بند تُقرره أنت بالـ**تأكيد** أو **التجاوز**. لا يُعتمد شيء رسميًا حتى تفعل ذلك — الذكاء الاصطناعي يقترح فقط. بعدها يكتب **ترحيل إلى القائمة الرسمية** أحكامك المؤكدة في لوحة التقييم الفعلية للطلب.",
  },
  {
    id: "external_deliverable",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    keywords: ["external deliverable", "attach certificate", "complete certificate issuance", "المستند الخارجي", "إرفاق الشهادة", "إكمال إصدار الشهادة"],
    en: "For SCOC/SABER/SFDA-cosmetics items, the **External Deliverable** panel appears from Decision onward: submit the external application, then once the real certificate comes back, upload it and mark it Issued (or Reject it with a reason). Attaching the certificate is what unlocks **Complete Certificate Issuance** — the only way a Report issued request reaches Closed.",
    ar: "لبنود SCOC/SABER/مستحضرات التجميل التابعة لـ SFDA، تظهر لوحة **المستند الخارجي** ابتداءً من مرحلة القرار: قدّم الطلب الخارجي، ثم بمجرد وصول الشهادة الفعلية، ارفعها وعلّمها كـ\"صادرة\" (أو ارفضها مع ذكر السبب). إرفاق الشهادة هو ما يُفعّل زر **إكمال إصدار الشهادة** — الطريقة الوحيدة لوصول طلب \"صدر التقرير\" إلى حالة \"تم\".",
  },

  // ── Technical Reviewer ────────────────────────────────────────────────
  {
    id: "technical_review_checklist",
    roles: ["TECHNICAL_REVIEWER", "SYSTEM_ADMIN"],
    keywords: ["technical review checklist", "advance to decision", "قائمة المراجعة الفنية", "التقدم للقرار"],
    en: "While a request is in Technical Review, fill in the **Technical Review Checklist** panel — one request-level meta-checklist (its questions are set globally by System Admin in Settings). Every item needs a verdict before **Advance to Decision** (after confirming the Conflict-of-Interest checkbox) is allowed.",
    ar: "أثناء وجود الطلب في مرحلة \"المراجعة الفنية\"، عبّئ لوحة **قائمة المراجعة الفنية** — قائمة تدقيق واحدة على مستوى الطلب (تُحدد أسئلتها عالميًا بواسطة مدير النظام في الإعدادات). يجب أن يحمل كل بند حكمًا قبل السماح بـ**التقدم للقرار** (بعد تأكيد مربع إقرار تضارب المصالح).",
  },

  // ── Decision Maker ────────────────────────────────────────────────────
  {
    id: "grant_refuse",
    roles: ["DECISION_MAKER", "SYSTEM_ADMIN"],
    keywords: ["grant certification", "refuse certification", "منح الشهادة", "رفض الشهادة"],
    en: "On a request in Decision, click **Grant Certification** to move it to Report issued (it's then unassigned, landing in an Evaluator's queue to finish issuing the certificate), or **Refuse Certification** (requires a refusal note) to close it directly without a report. Both require confirming the Conflict-of-Interest checkbox first.",
    ar: "في الطلب أثناء مرحلة \"القرار\"، اضغط **منح الشهادة** لنقله إلى \"صدر التقرير\" (يصبح بعدها غير مُسند، ليصل إلى قائمة انتظار أحد المُقيّمين لإكمال إصدار الشهادة)، أو **رفض الشهادة** (يتطلب ملاحظة رفض) لإغلاقه مباشرة دون تقرير. يتطلب كلاهما تأكيد مربع إقرار تضارب المصالح أولًا.",
  },

  // ── Finance ───────────────────────────────────────────────────────────
  {
    id: "finance_queue",
    roles: ["FINANCE", "SYSTEM_ADMIN"],
    keywords: ["confirm a payment", "reject a payment", "payment queue", "تأكيد دفعة", "رفض دفعة", "قائمة انتظار الدفعات"],
    en: "The Finance **Queue** tab lists pending payments clients submitted proof for. **Confirm** posts it to the client's ledger; **Reject** requires a reason (at least 3 characters). Use **View Proof** to check the uploaded payment evidence before deciding.",
    ar: "يعرض تبويب **قائمة الانتظار** في المالية الدفعات المعلقة التي قدّم العملاء إثباتًا لها. **تأكيد** يُرحّلها إلى دفتر حسابات العميل؛ **رفض** يتطلب سببًا (3 أحرف على الأقل). استخدم **عرض الإثبات** لمراجعة دليل الدفع المرفوع قبل اتخاذ القرار.",
  },
  {
    id: "finance_balances",
    roles: ["FINANCE", "SYSTEM_ADMIN"],
    keywords: ["credit limit", "client balance", "auto-hold", "الحد الائتماني", "رصيد العميل", "إيقاف تلقائي"],
    en: "The Finance **Balances** tab shows every client's balance and days-overdue, with an inline **credit limit** editor. Turning on \"auto-hold when over limit\" means that client's future requests get automatically held once they exceed the limit.",
    ar: "يعرض تبويب **الأرصدة** في المالية رصيد كل عميل وأيام التأخر، مع محرر **حد ائتماني** مضمّن. تفعيل \"إيقاف تلقائي عند تجاوز الحد\" يعني أن طلبات ذلك العميل المستقبلية ستُوقف تلقائيًا بمجرد تجاوز الحد.",
  },
  {
    id: "finance_adjust",
    roles: ["FINANCE", "SYSTEM_ADMIN"],
    keywords: ["manual ledger entry", "credit note", "write-off", "قيد يدوي", "إشعار دائن", "شطب"],
    en: "The Finance **Adjust** tab posts a manual ledger entry: pick the client, an entry type (Adjustment / Credit Note / Refund / Write-off), debit or credit, the amount, and — for Credit Note/Write-off — optionally settle it against a specific open invoice.",
    ar: "يُنشئ تبويب **التسوية** في المالية قيدًا يدويًا: اختر العميل، نوع القيد (تسوية / إشعار دائن / استرداد / شطب)، مدين أو دائن، المبلغ، ويمكن — لإشعار الدائن أو الشطب — تسويته مقابل فاتورة مفتوحة محددة.",
  },
  {
    id: "coupons_manage",
    roles: ["CATALOGUE_MANAGER", "FINANCE", "SYSTEM_ADMIN"],
    keywords: ["create a coupon", "discount code", "إنشاء قسيمة", "رمز خصم"],
    en: "On the **Coupons** page, **Create Coupon** sets the code, bilingual name, discount type (percent or fixed), scope (all services / a category / one service), which clients can use it, and a validity window. The table lets you activate, deactivate, or expire a coupon.",
    ar: "في صفحة **القسائم**، يحدد **إنشاء قسيمة** الرمز، والاسم بلغتين، ونوع الخصم (نسبة أو مبلغ ثابت)، والنطاق (كل الخدمات / فئة / خدمة واحدة)، والعملاء المسموح لهم باستخدامه، وفترة الصلاحية. يتيح الجدول تفعيل القسيمة أو تعطيلها أو إنهاء صلاحيتها.",
  },

  // ── Catalogue Manager ─────────────────────────────────────────────────
  {
    id: "create_service_wizard",
    roles: ["CATALOGUE_MANAGER", "SYSTEM_ADMIN"],
    keywords: ["create a service", "create service wizard", "add a new service", "إنشاء خدمة", "معالج إنشاء خدمة"],
    en: "**Create Service** on the Catalogue page is a 5-step wizard: (1) pick the category, (2) basics — code, SLA hours, bilingual name/description, price, VAT, resubmission pricing, which evaluation activities apply, (3) product attributes and the compliance check sets (these become the Evaluator's Assessment checklist), (4) required-document slots, (5) review and confirm.",
    ar: "**إنشاء خدمة** في صفحة الكتالوج معالج من 5 خطوات: (1) اختيار الفئة، (2) الأساسيات — الرمز، ساعات مدة الإنجاز، الاسم والوصف بلغتين، السعر، ضريبة القيمة المضافة، تسعير إعادة التقديم، أنشطة التقييم المطلوبة، (3) خصائص المنتج ومجموعات فحص المطابقة (تصبح قائمة تقييم المُقيّم)، (4) خانات المستندات المطلوبة، (5) المراجعة والتأكيد.",
  },
  {
    id: "manage_categories",
    roles: ["CATALOGUE_MANAGER", "SYSTEM_ADMIN"],
    keywords: ["manage categories", "main category", "sub category", "إدارة الفئات", "الفئة الرئيسية", "الفئة الفرعية"],
    en: "**Manage Categories** on the Catalogue page creates, renames, or deletes Main and Sub categories. Deleting one is blocked while it still has services or sub-categories under it — move or remove those first.",
    ar: "**إدارة الفئات** في صفحة الكتالوج تُنشئ أو تُعيد تسمية أو تحذف الفئات الرئيسية والفرعية. يُمنع حذف فئة إذا كانت لا تزال تحتوي على خدمات أو فئات فرعية — انقلها أو احذفها أولًا.",
  },
  {
    id: "laboratories_manage",
    roles: ["CATALOGUE_MANAGER", "SYSTEM_ADMIN"],
    keywords: ["manage laboratories", "add a laboratory", "test types", "إدارة المختبرات", "إضافة مختبر", "أنواع الاختبارات"],
    en: "The **Laboratories** page manages two reference tables: accredited Laboratories (code must be globally unique) and Test Types — both create/edit/toggle-active/delete, with delete blocked while a lab or test type is still referenced by a request. This is the data the Evaluator picks from when scheduling lab testing.",
    ar: "تدير صفحة **المختبرات** جدولين مرجعيين: المختبرات المعتمدة (يجب أن يكون الرمز فريدًا عالميًا) وأنواع الاختبارات — كلاهما بإنشاء/تعديل/تفعيل أو تعطيل/حذف، مع منع الحذف إذا كان المختبر أو نوع الاختبار لا يزال مُشارًا إليه في طلب. هذه هي البيانات التي يختار منها المُقيّم عند جدولة الاختبار المخبري.",
  },
  {
    id: "kb_datasets",
    roles: ["CATALOGUE_MANAGER", "SYSTEM_ADMIN"],
    keywords: ["manage datasets", "knowledge base", "kb version", "إدارة قواعد البيانات", "قاعدة المعرفة"],
    en: "**Manage Datasets** on the Label Evaluator pages controls the versioned knowledge base the AI rule engine checks labels against — creating a new version, editing its rules, and publishing it. This only affects Cosmetics/SFDA label evaluation.",
    ar: "**إدارة قواعد البيانات** في صفحات مُقيّم البطاقات تتحكم في قاعدة المعرفة الإصدارية التي يفحص محرك القواعد الذكي البطاقات بموجبها — إنشاء إصدار جديد، تعديل قواعده، ونشره. يؤثر هذا فقط على تقييم بطاقات مستحضرات التجميل و SFDA.",
  },

  // ── Quality Manager ───────────────────────────────────────────────────
  {
    id: "quality_page",
    roles: ["QUALITY_MANAGER", "DECISION_MAKER", "SYSTEM_ADMIN"],
    keywords: ["quality page", "return reasons", "صفحة الجودة", "أسباب الإعادة"],
    en: "The **Quality** page is a read-only dashboard: a breakdown of return reasons and a recent audit-log feed. There are no actions here — act on a finding by messaging the relevant staff member from the affected request's comment thread.",
    ar: "صفحة **الجودة** لوحة معلومات للقراءة فقط: توزيع أسباب الإعادة وتغذية حديثة لسجل التدقيق. لا توجد إجراءات هنا — تعامل مع أي ملاحظة بمراسلة الموظف المعني من خيط تعليقات الطلب المتأثر.",
  },
  {
    id: "audit_log",
    roles: ["QUALITY_MANAGER", "SYSTEM_ADMIN"],
    keywords: ["audit log", "audit page", "سجل التدقيق", "صفحة التدقيق"],
    en: "The **Audit** page is a system-wide, read-only browser of every audit-log entry (actor, action, entity, before/after), filterable by action and entity type — broader than the Quality page's return-reason summary.",
    ar: "صفحة **التدقيق** أداة عرض للقراءة فقط تغطي جميع سجلات التدقيق في النظام (الفاعل، الإجراء، الكيان، القيم قبل وبعد)، قابلة للفلترة حسب الإجراء ونوع الكيان — أوسع نطاقًا من ملخص أسباب الإعادة في صفحة الجودة.",
  },

  // ── System Admin ──────────────────────────────────────────────────────
  {
    id: "settings_staff",
    roles: ["SYSTEM_ADMIN"],
    keywords: ["invite staff", "change staff role", "deactivate staff", "دعوة موظف", "تغيير دور موظف", "تعطيل موظف"],
    en: "The **Staff** tab in Settings lets you invite a new Atlas staff member (set their initial role(s), sends an invite email), change an existing staff member's role(s), or deactivate their account. Role changes take effect on that person's next page load.",
    ar: "يتيح لك تبويب **الموظفون** في الإعدادات دعوة موظف جديد في أطلس (تحديد دوره الأولي، وإرسال بريد دعوة)، أو تغيير دور موظف حالي، أو تعطيل حسابه. تُطبّق تغييرات الدور عند تحميل الصفحة التالي لذلك الموظف.",
  },
  {
    id: "settings_checklist_editor",
    roles: ["SYSTEM_ADMIN"],
    keywords: ["edit technical review checklist", "checklist definition", "تعديل قائمة المراجعة الفنية", "تعريف القائمة"],
    en: "The **Technical Review Checklist** tab in Settings edits the single global checklist definition every Technical Reviewer fills in at that stage. Changes apply immediately to every request currently in Technical Review.",
    ar: "يُعدّل تبويب **قائمة المراجعة الفنية** في الإعدادات تعريف القائمة العالمية الواحدة التي يعبّئها كل مُراجع فني في تلك المرحلة. تُطبّق التغييرات فورًا على كل طلب موجود حاليًا في مرحلة المراجعة الفنية.",
  },
  {
    id: "system_health",
    roles: ["SYSTEM_ADMIN"],
    keywords: ["system health", "dead-lettered", "failed jobs", "سلامة النظام", "المهام الفاشلة"],
    en: "The **System Health** page is a read-only diagnostics view of background jobs that dead-lettered after exhausting retries (failed notifications, failed label-extraction jobs) plus a pending-outbox count. There's no retry button — it's for spotting things like a stuck email provider or expired API credential; the fix happens outside the app.",
    ar: "صفحة **سلامة النظام** أداة تشخيص للقراءة فقط تعرض المهام الخلفية التي فشلت نهائيًا بعد استنفاد محاولات إعادة المحاولة (إشعارات فاشلة، مهام استخراج بطاقات فاشلة) بالإضافة إلى عدد الرسائل المعلقة في صندوق الصادر. لا يوجد زر لإعادة المحاولة — الغرض منها رصد مشاكل مثل تعطل مزود البريد أو انتهاء صلاحية مفتاح API؛ يتم الإصلاح خارج التطبيق.",
  },
  {
    id: "system_admin_override",
    roles: ["SYSTEM_ADMIN"],
    keywords: ["system admin override", "act on any request", "صلاحيات مدير النظام", "التصرف في أي طلب"],
    en: "As System Admin you can transition any request from any state — you're not restricted to the four process roles' stage-specific actions. Use this for exceptions and stuck cases, not as a routine bypass of the normal workflow.",
    ar: "بصفتك مدير النظام، يمكنك نقل أي طلب من أي حالة — لست مقيدًا بإجراءات المرحلة الخاصة بالأدوار الأربعة. استخدم هذا للحالات الاستثنائية والعالقة، وليس كتجاوز روتيني لسير العمل الطبيعي.",
  },
];

/**
 * Returns a stored answer only on a clear match within the caller's own
 * roles: candidates outside `roles` are excluded before scoring, so a
 * reply can never describe a page or action that staff member can't reach.
 * Scoring and tie-handling live in keyword-match.ts.
 */
export function matchCannedAnswer(text: string, roles: Role[]): CannedAnswer | null {
  const entry = bestMatch(visibleTo(roles), text);
  return entry ? { en: entry.en, ar: entry.ar } : null;
}

function visibleTo(roles: Role[]): CannedEntry[] {
  return CANNED_ANSWERS.filter((entry) => !entry.roles || entry.roles.some((r) => roles.includes(r)));
}

/** Topics offered when nothing matched and there's no near-miss to suggest — all visible to every staff role. */
const HEADLINE_TOPIC_IDS = ["dashboard", "work_queues", "requests_search", "assign_request", "hold_resume", "documents_search"];

/**
 * The reply for a message no stored answer resolved. With the AI fallback
 * off (see ai-toggle.ts) this is the last word rather than a stepping
 * stone, so it names the topics closest to what was actually asked —
 * role-filtered like everything else here — instead of dead-ending.
 */
export function buildAdminFallbackReply(text: string, roles: Role[], locale: string): string {
  const visible = visibleTo(roles);
  const near = suggestEntries(visible, text, 5);
  const entries = near.length > 0 ? near : visible.filter((e) => HEADLINE_TOPIC_IDS.includes(e.id));
  const topics = entries.map((entry) => `- ${topicLabel(entry, locale)}`).join("\n");

  return locale === "ar"
    ? `ليست لديّ إجابة محفوظة لهذا السؤال تحديداً. يمكنني الإرشاد في المواضيع التالية ضمن صلاحياتك — اسألني عن أيٍّ منها:\n\n${topics}\n\nويمكنني أيضاً بيان متطلبات أي خدمة في الكتالوج أو ما ينص عليه بند تنظيمي مسجّل في قاعدة المعرفة. ولأي أمر خارج ذلك، يرجى الاستفسار من أحد الزملاء أو مدير النظام.`
    : `I don't have a stored answer for that one. Here's what I can guide you through within your access — ask me about any of these:\n\n${topics}\n\nI can also give you any catalogue service's requirements, or what a regulatory clause in the knowledge base says. For anything beyond that, please check with a colleague or System Admin.`;
}

/** Test seam: the matched topic's id, so coverage tests can assert routing without exporting the bank. */
export function matchCannedTopicId(text: string, roles: Role[]): string | null {
  return bestMatch(visibleTo(roles), text)?.id ?? null;
}
