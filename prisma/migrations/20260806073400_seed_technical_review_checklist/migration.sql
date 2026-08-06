-- Seeds the single global Technical Review checklist (doc's reviewer
-- meta-checklist, distinct from ServiceItem.checkSets). Idempotent, same
-- ON CONFLICT DO NOTHING style as 20260806052126_seed_saber_testing_cosmetics_catalogue.
INSERT INTO "TechnicalReviewChecklist" ("id", "checkSets", "updatedAt")
VALUES (
  'singleton',
  '[
    {
      "code": "TECHNICAL_REVIEW",
      "titleEn": "Technical Review Checklist",
      "titleAr": "قائمة تدقيق المراجعة الفنية",
      "items": [
        {
          "code": "EVALUATION_REPORT_REVIEWED",
          "titleEn": "Evaluation report reviewed",
          "titleAr": "تمت مراجعة تقرير التقييم"
        },
        {
          "code": "STANDARDS_VERIFIED",
          "titleEn": "Applicable standards verified",
          "titleAr": "تم التحقق من المواصفات المعتمدة"
        },
        {
          "code": "SUPPORTING_DOCS_VERIFIED",
          "titleEn": "Supporting documents verified",
          "titleAr": "تم التحقق من المستندات الداعمة"
        },
        {
          "code": "TEST_REPORTS_REVIEWED",
          "titleEn": "Test reports reviewed",
          "titleAr": "تمت مراجعة تقارير الاختبار"
        },
        {
          "code": "INSPECTION_AUDIT_REPORTS_REVIEWED",
          "titleEn": "Inspection/audit reports reviewed (if applicable)",
          "titleAr": "تمت مراجعة تقارير التفتيش/التدقيق (إن وجدت)"
        },
        {
          "code": "EVALUATION_CONCLUSION_VERIFIED",
          "titleEn": "Evaluation conclusion verified",
          "titleAr": "تم التحقق من نتيجة التقييم"
        }
      ]
    }
  ]'::jsonb,
  now()
)
ON CONFLICT ("id") DO NOTHING;
