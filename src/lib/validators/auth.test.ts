import assert from "node:assert/strict";
import { test } from "node:test";

import {
  passwordSchema,
  resetPasswordSchema,
  signupSchema,
} from "./auth";

test("passwordSchema requires ≥8 chars with a letter and a digit", () => {
  assert.equal(passwordSchema.safeParse("Atlas2026").success, true);

  // too short
  assert.equal(passwordSchema.safeParse("Atl2").success, false);
  // letters only
  assert.equal(passwordSchema.safeParse("password").success, false);
  // digits only
  assert.equal(passwordSchema.safeParse("12345678").success, false);
});

test("passwordSchema surfaces WEAK_PASSWORD as the error code", () => {
  const r = passwordSchema.safeParse("weak");
  assert.equal(r.success, false);
  if (!r.success) {
    assert.equal(r.error.issues[0]?.message, "WEAK_PASSWORD");
  }
});

test("resetPasswordSchema flags mismatched confirmation", () => {
  const r = resetPasswordSchema.safeParse({
    token: "a".repeat(20),
    password: "Atlas2026",
    confirmPassword: "Atlas2027",
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.equal(
      r.error.issues.some((i) => i.message === "PASSWORD_MISMATCH"),
      true,
    );
  }
});

test("signupSchema rejects a weak password even when confirmation matches", () => {
  const r = signupSchema.safeParse({
    companyNameEn: "Acme",
    companyNameAr: "أكمي",
    fullNameEn: "Jane Doe",
    fullNameAr: "جين",
    email: "jane@example.com",
    phone: "",
    password: "password", // no digit
    confirmPassword: "password",
    locale: "en",
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.equal(
      r.error.issues.some((i) => i.message === "WEAK_PASSWORD"),
      true,
    );
  }
});

test("signupSchema accepts a valid client registration", () => {
  const r = signupSchema.safeParse({
    companyNameEn: "Acme",
    companyNameAr: "أكمي",
    fullNameEn: "Jane Doe",
    fullNameAr: "جين",
    email: "Jane@Example.com",
    phone: "+966512345678",
    password: "Atlas2026",
    confirmPassword: "Atlas2026",
    locale: "ar",
  });
  assert.equal(r.success, true);
  if (r.success) {
    // email is normalised to lowercase by the schema
    assert.equal(r.data.email, "jane@example.com");
  }
});
