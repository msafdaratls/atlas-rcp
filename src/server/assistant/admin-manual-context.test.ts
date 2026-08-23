import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAdminManualContext } from "./admin-manual-context";

describe("buildAdminManualContext", () => {
  it("includes role-restricted sections only for a role that holds them", () => {
    const financeContext = buildAdminManualContext(["FINANCE"]);
    assert.match(financeContext, /## Finance/);
    assert.doesNotMatch(financeContext, /## Service Catalogue management/);
    assert.doesNotMatch(financeContext, /## System Health/);
  });

  it("always includes sections with no role restriction, for any role", () => {
    const evaluatorContext = buildAdminManualContext(["EVALUATOR"]);
    assert.match(evaluatorContext, /## Dashboard and Analytics/);
    assert.match(evaluatorContext, /## Work Queues/);
  });

  it("includes a section visible to any one of a multi-role user's roles", () => {
    const context = buildAdminManualContext(["EVALUATOR", "CATALOGUE_MANAGER"]);
    assert.match(context, /## Evaluation activities/);
    assert.match(context, /## Service Catalogue management/);
  });

  it("gives SYSTEM_ADMIN-only sections only to SYSTEM_ADMIN", () => {
    assert.match(buildAdminManualContext(["SYSTEM_ADMIN"]), /## Settings/);
    assert.doesNotMatch(buildAdminManualContext(["EVALUATOR"]), /## Settings/);
  });
});
