import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequiredDocument, ServiceItem } from "@prisma/client";
import { formatServiceForClient, matchService } from "./service-lookup";

function service(
  overrides: Partial<ServiceItem> & { requiredDocuments?: RequiredDocument[] },
): ServiceItem & { requiredDocuments: RequiredDocument[] } {
  return {
    id: "svc_1",
    subCategoryId: "sub_1",
    code: "SAB-001",
    nameEn: "Product Certificate of Conformity (PCOC)",
    nameAr: "شهادة مطابقة المنتج",
    descEn: null,
    descAr: null,
    basePrice: 500 as unknown as ServiceItem["basePrice"],
    vatRate: 0.15 as unknown as ServiceItem["vatRate"],
    resubmissionPricePct: 0.5 as unknown as ServiceItem["resubmissionPricePct"],
    slaHours: 48,
    freeResubmissions: 1,
    maxResubmissions: 3,
    productAttrSchema: {},
    checkSets: [],
    requiresInspection: false,
    requiresLabTesting: false,
    requiresFactoryAudit: false,
    deliverableEn: "PCOC certificate",
    deliverableAr: null,
    deliverableType: "EXTERNAL_CERTIFICATE" as ServiceItem["deliverableType"],
    requiredCredentialPlatform: null,
    defaultEvaluatorId: null,
    sortOrder: 0,
    active: true,
    requiredDocuments: [],
    ...overrides,
  };
}

describe("matchService", () => {
  it("matches on a distinctive acronym in the service name", () => {
    const pcoc = service({ id: "s1" });
    const scoc = service({
      id: "s2",
      code: "SAB-002",
      nameEn: "Shipment Certificate of Conformity (SCOC)",
      deliverableEn: "SCOC certificate",
    });
    const result = matchService([pcoc, scoc], "What's the price for a PCOC?");
    assert.equal(result?.id, "s1");
  });

  it("matches on service-name words via substring, e.g. 'lab testing' against 'Laboratory Testing Coordination'", () => {
    const lab = service({ id: "s3", code: "LAB-001", nameEn: "Laboratory Testing Coordination" });
    const result = matchService([lab], "What's the SLA for lab testing?");
    assert.equal(result?.id, "s3");
  });

  it("returns null on a tie between two services sharing the same distinctive word", () => {
    const cosmeticScoc = service({ id: "s1", code: "SAB-002", nameEn: "Cosmetic Shipment Certificate of Conformity (SCOC)" });
    const genericScoc = service({ id: "s2", code: "SAB-003", nameEn: "Shipment Certificate of Conformity (SCOC)" });
    const result = matchService([cosmeticScoc, genericScoc], "Tell me about the SCOC");
    assert.equal(result, null);
  });

  it("returns null when nothing scores", () => {
    const pcoc = service({ id: "s1" });
    const result = matchService([pcoc], "How do I reset my password?");
    assert.equal(result, null);
  });
});

describe("formatServiceForClient", () => {
  it("includes price incl. VAT, SLA, and documents, in English", () => {
    const svc = service({
      requiredDocuments: [
        { id: "d1", serviceItemId: "s1", nameEn: "Product label", nameAr: "ملصق المنتج", mandatory: true, helpEn: null, helpAr: null, sortOrder: 0 } as RequiredDocument,
      ],
    });
    const text = formatServiceForClient(svc, "en");
    assert.match(text, /575\.00 SAR total/); // 500 + 15% VAT
    assert.match(text, /48 hours/);
    assert.match(text, /Product label/);
  });

  it("renders in Arabic when locale is ar", () => {
    const svc = service({});
    const text = formatServiceForClient(svc, "ar");
    assert.match(text, /شهادة مطابقة المنتج/);
    assert.match(text, /مدة الإنجاز/);
  });
});
