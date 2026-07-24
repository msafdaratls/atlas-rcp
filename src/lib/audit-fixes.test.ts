import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { isOverCreditLimit } from "@/lib/credit-limit";
import {
  exceedsMaxResubmissions,
  invoiceDueAt,
  isNewClientOrg,
  parsePercentCouponValue,
} from "@/lib/billing-helpers";
import { resumeSlaDueAt, slaDedupeKey } from "@/lib/sla";
import { consumeRateLimit, resetRateLimitBuckets } from "@/lib/rate-limit";
import { sniffMime, mimeAllowed } from "@/lib/mime-sniff";
import { statementBalances, endOfDayInclusive } from "@/lib/statement-balance";

describe("isOverCreditLimit", () => {
  it("allows when auto-hold off", () => {
    assert.equal(
      isOverCreditLimit({
        autoHoldWhenOverLimit: false,
        creditLimit: new Prisma.Decimal(0),
        balance: new Prisma.Decimal(1000),
        upcomingTotal: new Prisma.Decimal(500),
      }),
      false,
    );
  });

  it("blocks any charge when limit is 0 and auto-hold on", () => {
    assert.equal(
      isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: new Prisma.Decimal(0),
        balance: new Prisma.Decimal(0),
        upcomingTotal: new Prisma.Decimal(100),
      }),
      true,
    );
  });

  it("blocks when balance + upcoming reaches limit", () => {
    assert.equal(
      isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: new Prisma.Decimal(1000),
        balance: new Prisma.Decimal(800),
        upcomingTotal: new Prisma.Decimal(200),
      }),
      true,
    );
  });

  it("allows when under limit after upcoming", () => {
    assert.equal(
      isOverCreditLimit({
        autoHoldWhenOverLimit: true,
        creditLimit: new Prisma.Decimal(1000),
        balance: new Prisma.Decimal(500),
        upcomingTotal: new Prisma.Decimal(200),
      }),
      false,
    );
  });
});

describe("billing helpers", () => {
  it("invoiceDueAt respects payment terms days", () => {
    const issued = new Date("2026-07-01T12:00:00.000Z");
    assert.equal(
      invoiceDueAt(issued, 0).toISOString(),
      issued.toISOString(),
    );
    assert.equal(
      invoiceDueAt(issued, 15).toISOString(),
      new Date("2026-07-16T12:00:00.000Z").toISOString(),
    );
  });

  it("maxResubmissions allows initial + N resubmits", () => {
    assert.equal(exceedsMaxResubmissions(1, 1), false); // next=2 OK
    assert.equal(exceedsMaxResubmissions(2, 1), true); // next=3 blocked
    assert.equal(exceedsMaxResubmissions(1, 0), true); // no resubmits
  });

  it("isNewClientOrg uses submitted count", () => {
    assert.equal(isNewClientOrg(0), true);
    assert.equal(isNewClientOrg(1), false);
  });

  it("percent coupons reject >100", () => {
    assert.equal(parsePercentCouponValue(new Prisma.Decimal(150)), null);
    assert.ok(parsePercentCouponValue(new Prisma.Decimal(50)));
  });
});

describe("sla helpers", () => {
  it("dedupe key includes submittedAt cycle", () => {
    const t = new Date("2026-07-24T10:00:00.000Z");
    assert.equal(
      slaDedupeKey("SLA_BREACHED", "req1", t),
      "SLA_BREACHED:req1:2026-07-24T10:00:00.000Z",
    );
  });

  it("resumeSlaDueAt extends by paused ms", () => {
    const due = new Date("2026-07-24T18:00:00.000Z");
    const paused = new Date("2026-07-24T12:00:00.000Z");
    const resumed = new Date("2026-07-24T14:00:00.000Z");
    const next = resumeSlaDueAt({
      slaDueAt: due,
      slaPausedAt: paused,
      resumedAt: resumed,
    });
    assert.equal(next?.toISOString(), "2026-07-24T20:00:00.000Z");
  });
});

describe("rate limit", () => {
  it("blocks after limit", () => {
    resetRateLimitBuckets();
    const key = "login:test";
    assert.equal(consumeRateLimit({ key, limit: 2, windowMs: 60_000 }).ok, true);
    assert.equal(consumeRateLimit({ key, limit: 2, windowMs: 60_000 }).ok, true);
    assert.equal(consumeRateLimit({ key, limit: 2, windowMs: 60_000 }).ok, false);
  });
});

describe("mime sniff", () => {
  it("detects PNG and PDF", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    assert.equal(sniffMime(png), "image/png");
    const pdf = Buffer.from("%PDF-1.4\n");
    assert.equal(sniffMime(pdf), "application/pdf");
    assert.equal(mimeAllowed("image/png", ["image/png", "image/jpeg"]), true);
    assert.equal(mimeAllowed("image/svg+xml", ["image/png"]), false);
  });
});

describe("statementBalances", () => {
  it("uses all entries for balance, period for net", () => {
    const all = [
      { debit: new Prisma.Decimal(100), credit: new Prisma.Decimal(0) },
      { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(40) },
      { debit: new Prisma.Decimal(50), credit: new Prisma.Decimal(0) },
    ];
    const period = [all[2]!];
    const result = statementBalances({
      allEntries: all,
      periodEntries: period,
      creditLimit: new Prisma.Decimal(200),
    });
    assert.equal(result.balance.toString(), "110");
    assert.equal(result.periodNet.toString(), "50");
    assert.equal(result.creditUsedPct, 55);
  });

  it("endOfDayInclusive expands date-only", () => {
    const d = endOfDayInclusive("2026-07-24");
    assert.ok(d);
    assert.equal(d.getHours(), 23);
    assert.equal(d.getMinutes(), 59);
  });
});
