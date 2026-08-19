import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { planFifoAllocation } from "./payment-allocation";

function invoice(id: string, total: number, paid: number[] = []) {
  return {
    id,
    total: new Prisma.Decimal(total),
    allocations: paid.map((amount) => ({ amount: new Prisma.Decimal(amount) })),
  };
}

describe("planFifoAllocation", () => {
  it("pays the single open invoice in full when the payment covers it exactly", () => {
    const plan = planFifoAllocation(new Prisma.Decimal(500), [invoice("inv-1", 500)]);
    assert.deepEqual(
      plan.map((p) => [p.invoiceId, p.amount.toString()]),
      [["inv-1", "500"]],
    );
  });

  it("pays the oldest-due invoice first, then spills into the next", () => {
    // Caller is responsible for ordering oldest-due-first; this list is
    // already in that order.
    const plan = planFifoAllocation(new Prisma.Decimal(700), [
      invoice("inv-old", 500),
      invoice("inv-new", 500),
    ]);
    assert.deepEqual(
      plan.map((p) => [p.invoiceId, p.amount.toString()]),
      [
        ["inv-old", "500"],
        ["inv-new", "200"],
      ],
    );
  });

  it("stops once the payment is exhausted, leaving later invoices untouched", () => {
    const plan = planFifoAllocation(new Prisma.Decimal(300), [
      invoice("inv-1", 500),
      invoice("inv-2", 500),
    ]);
    assert.deepEqual(
      plan.map((p) => [p.invoiceId, p.amount.toString()]),
      [["inv-1", "300"]],
    );
  });

  it("only allocates against the remaining open balance, not the invoice total", () => {
    // inv-1 already has 300 allocated against a 500 total -> only 200 open.
    const plan = planFifoAllocation(new Prisma.Decimal(1000), [
      invoice("inv-1", 500, [300]),
      invoice("inv-2", 500),
    ]);
    assert.deepEqual(
      plan.map((p) => [p.invoiceId, p.amount.toString()]),
      [
        ["inv-1", "200"],
        ["inv-2", "500"],
      ],
    );
  });

  it("skips an invoice that's already fully covered by prior allocations", () => {
    const plan = planFifoAllocation(new Prisma.Decimal(500), [
      invoice("inv-paid", 500, [500]),
      invoice("inv-open", 500),
    ]);
    assert.deepEqual(
      plan.map((p) => [p.invoiceId, p.amount.toString()]),
      [["inv-open", "500"]],
    );
  });

  it("produces an empty plan for a zero payment", () => {
    const plan = planFifoAllocation(new Prisma.Decimal(0), [invoice("inv-1", 500)]);
    assert.deepEqual(plan, []);
  });

  it("produces an empty plan when there are no open invoices", () => {
    const plan = planFifoAllocation(new Prisma.Decimal(500), []);
    assert.deepEqual(plan, []);
  });

  it("leaves an overpayment unallocated rather than allocating more than any invoice owes", () => {
    const plan = planFifoAllocation(new Prisma.Decimal(1000), [invoice("inv-1", 500)]);
    const allocated = plan.reduce((a, p) => a.plus(p.amount), new Prisma.Decimal(0));
    assert.equal(allocated.toString(), "500");
  });
});
