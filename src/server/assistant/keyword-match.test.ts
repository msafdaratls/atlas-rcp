import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bestMatch, scoreKeywords, suggestEntries, tokenize, topicLabel } from "./keyword-match";

describe("tokenize", () => {
  it("drops grammatical glue so a keyword phrase survives rephrasing", () => {
    assert.deepEqual(tokenize("How do I submit a request?"), ["submit", "request"]);
  });

  it("drops the one-character debris left by an apostrophe", () => {
    // "can't" -> "can t"; a bare "t" would otherwise match many keywords.
    assert.deepEqual(tokenize("I can't sign in"), ["sign"]);
  });

  it("folds Arabic diacritics, hamza forms and the definite article", () => {
    assert.deepEqual(tokenize("أُعيد الطلب"), ["اعيد", "طلب"]);
  });

  it("drops Arabic stopwords despite their pre-normalization spelling", () => {
    // Written "على"/"الى"/"متى" but normalized to "علي"/"الي"/"متي" before
    // lookup; entries stored un-normalized never matched and survived as
    // scoring tokens, making every phrase containing them harder to match.
    assert.deepEqual(tokenize("على الى متى"), []);
  });

  it("does not strip a leading alef-lam that is not the definite article", () => {
    assert.deepEqual(tokenize("إلغاء"), ["الغاء"]);
    assert.deepEqual(tokenize("إلكتروني"), ["الكتروني"]);
    // The real article is still stripped.
    assert.deepEqual(tokenize("الطلبات"), ["طلبات"]);
  });
});

describe("scoreKeywords", () => {
  it("scores a longer phrase higher than an incidental single-word overlap", () => {
    const tokens = tokenize("what are the four steps of the request wizard");
    assert.ok(scoreKeywords(["request wizard"], tokens) > scoreKeywords(["request"], tokens));
  });

  it("matches across a plural", () => {
    assert.equal(scoreKeywords(["invoice"], tokenize("where are my invoices")), 1);
  });

  it("matches an Arabic possessive suffix", () => {
    assert.equal(scoreKeywords(["حالة الطلب"], tokenize("كيف أتابع حالة طلبي؟")), 2);
  });

  it("does not let a message token match a keyword it is only a suffix of", () => {
    // "submit" must not satisfy "resubmit" — that answered the wrong question.
    assert.equal(scoreKeywords(["resubmit"], tokenize("how to submit request")), 0);
  });

  it("does not match a Latin keyword buried inside an unrelated word", () => {
    // "word file" once scored against "password"/"profile" and answered a
    // locked-out client with a list of accepted upload formats.
    assert.equal(scoreKeywords(["word file"], tokenize("change my password on my profile")), 0);
    assert.equal(scoreKeywords(["form"], tokenize("platform information")), 0);
    assert.equal(scoreKeywords(["work"], tokenize("artwork")), 0);
    // A genuine prefix is still a match — "format" really does start with "form".
    assert.equal(scoreKeywords(["form"], tokenize("what file format")), 1);
  });

  it("stems an Arabic message token against a longer keyword token", () => {
    // طلب must satisfy the keyword طلبي; a floor of 4 excluded three-letter
    // roots, which is most of them.
    assert.ok(scoreKeywords(["إلغاء طلبي"], tokenize("هل يمكنني إلغاء الطلب؟")) > 0);
  });

  it("counts two keywords that collapse to the same tokens only once", () => {
    const tokens = tokenize("where is my certificate");
    assert.equal(scoreKeywords(["get my certificate", "where is my certificate"], tokens), 1);
  });
});

describe("bestMatch", () => {
  const entries = [
    { id: "alpha", keywords: ["upload a document"] },
    { id: "beta", keywords: ["download a document"] },
  ];

  it("returns the single clear winner", () => {
    assert.equal(bestMatch(entries, "how do I upload a document")?.id, "alpha");
  });

  it("returns null on a tie rather than guessing which topic was meant", () => {
    assert.equal(bestMatch(entries, "document"), null);
  });

  it("returns null when the message has no usable tokens", () => {
    assert.equal(bestMatch(entries, "???"), null);
  });
});

describe("suggestEntries", () => {
  it("surfaces near misses that were not confident enough to answer outright", () => {
    const entries = [
      { id: "alpha", keywords: ["upload a document"] },
      { id: "beta", keywords: ["coupon code"] },
    ];
    assert.deepEqual(suggestEntries(entries, "document", 5).map((e) => e.id), ["alpha"]);
  });
});

describe("topicLabel", () => {
  const entry = { id: "x", keywords: ["submit a request", "تقديم طلب"] };

  it("labels in the caller's language", () => {
    assert.equal(topicLabel(entry, "en"), "submit a request");
    assert.equal(topicLabel(entry, "ar"), "تقديم طلب");
  });
});
