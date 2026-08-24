-- Seed the Laboratory/TestType reference catalogue for LAB-001 (Laboratory
-- Testing Coordination). Migration 20260818074643_add_laboratory_test_catalog
-- only created these tables (DDL) — it never inserted rows. `prisma/seed.ts`
-- populates them in dev via its destructive wipe+reseed, but prod runs
-- `prisma migrate deploy`, which never calls seed.ts, so both tables are
-- empty in prod and the "select a laboratory" step of LAB-001 is dead there.
-- Idempotent (ON CONFLICT ("code") DO NOTHING), same style as
-- 20260806073400_seed_technical_review_checklist. Data mirrors seed.ts
-- exactly so dev and prod agree.

-- ── Accredited laboratories ─────────────────────────────────────────────────
INSERT INTO "Laboratory" ("id", "code", "nameEn", "nameAr", "accreditationScopeEn", "accreditationScopeAr", "contactName", "contactEmail", "contactPhone", "sortOrder", "updatedAt") VALUES
  ('lab_saso_01', 'LAB-SASO-01', 'SASO National Testing Laboratory', 'المختبر الوطني للاختبارات (SASO)',
   'Chemical & microbiological testing — food, cosmetics, consumer products.',
   'اختبارات كيميائية وميكروبيولوجية - أغذية، مستحضرات تجميل، منتجات استهلاكية.',
   'Eng. Nawaf Al-Zahrani', 'labs@saso-lab.example.sa', '+966114440001', 1, now()),
  ('lab_intertek_01', 'LAB-INTERTEK-01', 'Intertek Saudi Arabia', 'إنترتك السعودية',
   'GSO/SASO conformity testing, electricals, textiles, toys.',
   'اختبارات مطابقة GSO/SASO، الأجهزة الكهربائية، المنسوجات، الألعاب.',
   'Lina Haddad', 'riyadh.lab@intertek.example.com', '+966114440002', 2, now()),
  ('lab_sgs_01', 'LAB-SGS-01', 'SGS Gulf Testing Center', 'مركز SGS الخليجي للاختبارات',
   'Heavy metals, packaging, cosmetics microbiology.',
   'المعادن الثقيلة، التغليف، ميكروبيولوجيا مستحضرات التجميل.',
   'Omar Fakhoury', 'gulf.lab@sgs.example.com', '+966114440003', 3, now())
ON CONFLICT ("code") DO NOTHING;

-- ── Test catalogue (LAB-001 required-tests checklist) ───────────────────────
INSERT INTO "TestType" ("id", "code", "nameEn", "nameAr", "sortOrder", "updatedAt") VALUES
  ('test_micro_limits', 'TEST-MICRO-LIMITS', 'Microbial limits', 'الحدود الميكروبية', 1, now()),
  ('test_heavy_metals', 'TEST-HEAVY-METALS', 'Heavy metals screen', 'فحص المعادن الثقيلة', 2, now()),
  ('test_gso_1943', 'TEST-GSO-1943', 'GSO 1943 compliance', 'مطابقة المواصفة الخليجية GSO 1943', 3, now()),
  ('test_ph_stability', 'TEST-PH-STABILITY', 'pH & stability', 'درجة الحموضة والثبات', 4, now()),
  ('test_preservative', 'TEST-PRESERVATIVE', 'Preservative efficacy', 'فعالية المواد الحافظة', 5, now()),
  ('test_flammability', 'TEST-FLAMMABILITY', 'Flammability', 'قابلية الاشتعال', 6, now()),
  ('test_electrical_safety', 'TEST-ELECTRICAL-SAFETY', 'Electrical safety', 'السلامة الكهربائية', 7, now()),
  ('test_mechanical_safety', 'TEST-MECHANICAL-SAFETY', 'Mechanical/physical safety', 'السلامة الميكانيكية/الفيزيائية', 8, now())
ON CONFLICT ("code") DO NOTHING;
