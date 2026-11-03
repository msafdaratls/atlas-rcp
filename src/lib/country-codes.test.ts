import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COUNTRY_CODES,
  DEFAULT_DIAL_CODE,
  findCountryByDialCode,
  phonePlaceholder,
} from "@/lib/country-codes";

describe("COUNTRY_CODES", () => {
  it("gives every country an example matching its own nsnLength", () => {
    // The signup validator rejects any national number whose length is not
    // nsnLength, so a placeholder that disagrees would be telling users to
    // type something the form refuses.
    for (const country of COUNTRY_CODES) {
      assert.equal(
        country.example.length,
        country.nsnLength,
        `${country.iso} example "${country.example}" is ${country.example.length} digits, expected ${country.nsnLength}`,
      );
    }
  });

  it("uses digits only in examples, with no leading zero", () => {
    // The validator strips leading zeros before measuring, so an example that
    // started with one would not survive its own length check.
    for (const country of COUNTRY_CODES) {
      assert.match(country.example, /^[1-9]\d*$/, `${country.iso} example must be digits with no leading zero`);
    }
  });

  it("has no duplicate dial codes or ISO codes", () => {
    const dialCodes = COUNTRY_CODES.map((c) => c.dialCode);
    const isoCodes = COUNTRY_CODES.map((c) => c.iso);
    assert.equal(new Set(dialCodes).size, dialCodes.length, "duplicate dial code");
    assert.equal(new Set(isoCodes).size, isoCodes.length, "duplicate ISO code");
  });

  it("resolves the default dial code to a real country", () => {
    assert.ok(findCountryByDialCode(DEFAULT_DIAL_CODE));
  });
});

describe("phonePlaceholder", () => {
  it("returns the selected country's example", () => {
    assert.equal(phonePlaceholder("+966"), "512345678");
    assert.equal(phonePlaceholder("+82"), "1012345678");
  });

  it("returns an empty string for an unknown dial code", () => {
    assert.equal(phonePlaceholder("+999"), "");
  });
});
