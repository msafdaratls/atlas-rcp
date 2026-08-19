import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  computeOrderBreakdown,
  computePriceBreakdown,
  parseMoneyInput,
  toNumber,
} from "./pricing";

describe("computePriceBreakdown", () => {
  it("applies the default 15% VAT when no rate is given", () => {
    const b = computePriceBreakdown({ basePrice: 1000 });
    assert.equal(b.subtotal.toString(), "1000");
    assert.equal(b.vatAmount.toString(), "150");
    assert.equal(b.total.toString(), "1150");
  });

  it("computes VAT on the discounted (taxable) amount, not the subtotal", () => {
    const b = computePriceBreakdown({ basePrice: 1000, discount: 200, vatRate: 0.15 });
    assert.equal(b.discount.toString(), "200");
    // taxable = 800, vat = 120
    assert.equal(b.vatAmount.toString(), "120");
    assert.equal(b.total.toString(), "920");
  });

  it("clamps a discount larger than the subtotal instead of going negative", () => {
    const b = computePriceBreakdown({ basePrice: 500, discount: 5000, vatRate: 0.15 });
    assert.equal(b.discount.toString(), "500");
    assert.equal(b.vatAmount.toString(), "0");
    assert.equal(b.total.toString(), "0");
  });

  it("accepts string/number inputs identically", () => {
    const fromString = computePriceBreakdown({ basePrice: "1000", vatRate: "0.15" });
    const fromNumber = computePriceBreakdown({ basePrice: 1000, vatRate: 0.15 });
    assert.equal(fromString.total.toString(), fromNumber.total.toString());
  });
});

describe("computeOrderBreakdown", () => {
  it("matches computePriceBreakdown for a single item (no discount)", () => {
    const order = computeOrderBreakdown([{ basePrice: 1000, vatRate: 0.15 }]);
    assert.equal(order.subtotal.toString(), "1000");
    assert.equal(order.vatAmount.toString(), "150");
    assert.equal(order.total.toString(), "1150");
  });

  it("allocates a single order-level discount proportionally across items with DIFFERENT vat rates", () => {
    // Two items, 900 (15% VAT) + 100 (0% VAT) = 1000 subtotal, 100 discount.
    // Item 1 share = 90% -> absorbs 90 of the discount -> taxable 810 -> vat 121.50
    // Item 2 share = 10% -> absorbs 10 of the discount -> taxable 90 -> vat 0
    const order = computeOrderBreakdown(
      [
        { basePrice: 900, vatRate: 0.15 },
        { basePrice: 100, vatRate: 0 },
      ],
      100,
    );
    assert.equal(order.subtotal.toString(), "1000");
    assert.equal(order.discount.toString(), "100");
    assert.equal(order.vatAmount.toString(), "121.5");
    assert.equal(order.total.toString(), "1021.5");
  });

  it("never lets the allocated discount exceed the subtotal", () => {
    const order = computeOrderBreakdown(
      [
        { basePrice: 300, vatRate: 0.15 },
        { basePrice: 200, vatRate: 0.15 },
      ],
      10_000,
    );
    assert.equal(order.discount.toString(), "500");
    assert.equal(order.total.toString(), "0");
  });

  it("handles an empty item list without dividing by zero", () => {
    const order = computeOrderBreakdown([], 0);
    assert.equal(order.subtotal.toString(), "0");
    assert.equal(order.vatAmount.toString(), "0");
    assert.equal(order.total.toString(), "0");
  });

  it("sums correctly across more than two items", () => {
    const order = computeOrderBreakdown([
      { basePrice: 100, vatRate: 0.15 },
      { basePrice: 200, vatRate: 0.15 },
      { basePrice: 300, vatRate: 0.15 },
    ]);
    assert.equal(order.subtotal.toString(), "600");
    assert.equal(order.vatAmount.toString(), "90");
    assert.equal(order.total.toString(), "690");
  });
});

describe("toNumber", () => {
  it("converts a Decimal, string, and number to the same JS number", () => {
    assert.equal(toNumber(new Prisma.Decimal("12.5")), 12.5);
    assert.equal(toNumber("12.5"), 12.5);
    assert.equal(toNumber(12.5), 12.5);
  });
});

describe("parseMoneyInput", () => {
  it("parses a valid string amount to a 2dp Decimal", () => {
    const d = parseMoneyInput("123.456");
    assert.equal(d?.toString(), "123.46");
  });

  it("parses a valid number amount", () => {
    const d = parseMoneyInput(50);
    assert.equal(d?.toString(), "50");
  });

  it("returns null for empty/null/undefined", () => {
    assert.equal(parseMoneyInput(""), null);
    assert.equal(parseMoneyInput(null), null);
    assert.equal(parseMoneyInput(undefined), null);
  });

  it("returns null for NaN-like input", () => {
    assert.equal(parseMoneyInput("not-a-number"), null);
  });

  it("returns null below the min bound", () => {
    assert.equal(parseMoneyInput(-5, { min: 0.01 }), null);
  });

  it("returns null above the max bound", () => {
    assert.equal(parseMoneyInput(20_000_000, { max: 10_000_000 }), null);
  });

  it("accepts a value exactly at the min/max bounds", () => {
    assert.equal(parseMoneyInput(0.01, { min: 0.01, max: 100 })?.toString(), "0.01");
    assert.equal(parseMoneyInput(100, { min: 0.01, max: 100 })?.toString(), "100");
  });

  it("rejects Infinity", () => {
    assert.equal(parseMoneyInput(Infinity, { max: 10_000_000 }), null);
  });
});
