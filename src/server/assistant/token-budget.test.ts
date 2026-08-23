import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTokenBudgetExceeded, recordTokenUsage } from "./token-budget";

describe("token-budget surface separation", () => {
  it("tracks the client and admin daily budgets independently", async () => {
    assert.equal(await isTokenBudgetExceeded("client"), false);
    assert.equal(await isTokenBudgetExceeded("admin"), false);

    process.env.ADMIN_ASSISTANT_DAILY_TOKEN_BUDGET = "100";
    try {
      await recordTokenUsage(150, "admin");

      assert.equal(await isTokenBudgetExceeded("admin"), true);
      // Spend recorded against "admin" must never count toward "client"'s budget.
      assert.equal(await isTokenBudgetExceeded("client"), false);
    } finally {
      delete process.env.ADMIN_ASSISTANT_DAILY_TOKEN_BUDGET;
    }
  });
});
