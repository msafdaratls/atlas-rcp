import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";

import { balanceFromEntries, isOverCreditLimit } from "@/lib/credit-limit";

const d = (n: number) => new Prisma.Decimal(n);

describe("isOverCreditLimit", () => {
  it("always allows when autoHoldWhenOverLimit is off, no matter the balance", () => {
    const result = isOverCreditLimit({
      autoHoldWhenOverLimit: false,
      creditLimit: d(100),
      balance: d(1_000_000),
      upcomingTotal: d(1_000_000),
    });
    assert.equal(result, false);
  });

  describe("creditLimit <= 0 (no limit configured) with auto-hold on", () => {
    it("blocks any positive upcoming charge", () => {
      const result = isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: d(0),
        balance: d(0),
        upcomingTotal: d(0.01),
      });
      assert.equal(result, true);
    });

    it("allows a zero-value upcoming charge", () => {
      const result = isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: d(0),
        balance: d(0),
        upcomingTotal: d(0),
      });
      assert.equal(result, false);
    });

    it("treats a negative creditLimit the same as zero", () => {
      const result = isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: d(-50),
        balance: d(0),
        upcomingTotal: d(10),
      });
      assert.equal(result, true);
    });
  });

  describe("creditLimit > 0", () => {
    it("blocks when balance + upcoming exactly equals the limit (boundary is inclusive)", () => {
      const result = isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: d(1000),
        balance: d(900),
        upcomingTotal: d(100),
      });
      assert.equal(result, true);
    });

    it("allows when balance + upcoming is one cent under the limit", () => {
      const result = isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: d(1000),
        balance: d(900),
        upcomingTotal: d(99.99),
      });
      assert.equal(result, false);
    });

    it("blocks when balance alone already exceeds the limit, even with no upcoming charge", () => {
      const result = isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: d(1000),
        balance: d(1500),
        upcomingTotal: d(0),
      });
      assert.equal(result, true);
    });

    it("clamps a negative upcomingTotal to zero rather than reducing exposure", () => {
      const result = isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: d(1000),
        balance: d(1500),
        upcomingTotal: d(-2000),
      });
      // balance (1500) already >= limit (1000); a negative upcoming must not
      // "rescue" the charge back under the limit.
      assert.equal(result, true);
    });
  });
});

describe("balanceFromEntries", () => {
  it("sums debits minus credits across entries", () => {
    const balance = balanceFromEntries([
      { debit: d(100), credit: d(0) },
      { debit: d(0), credit: d(30) },
      { debit: d(50), credit: d(0) },
    ]);
    assert.equal(balance.toString(), "120");
  });

  it("returns zero for no entries", () => {
    assert.equal(balanceFromEntries([]).toString(), "0");
  });
});
