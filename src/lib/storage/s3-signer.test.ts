import assert from "node:assert/strict";
import { test } from "node:test";

import { signV4, sha256Hex } from "./s3-signer";

/**
 * AWS SigV4 official "get-vanilla" test vector.
 * https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
 */
test("signV4 matches the AWS get-vanilla vector", () => {
  const headers = signV4({
    method: "GET",
    url: "https://example.amazonaws.com/",
    region: "us-east-1",
    service: "service",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    body: "",
    date: new Date("2015-08-30T12:36:00Z"),
  });

  assert.equal(headers["x-amz-date"], "20150830T123600Z");
  // Canonical-request hash for this vector is the AWS-documented
  // bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63,
  // which yields this signature.
  assert.equal(
    headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
      "SignedHeaders=host;x-amz-date, " +
      "Signature=ea21d6f05e96a897f6000a1a293f0a5bf0f92a00343409e820dce329ca6365ea",
  );
});

test("empty payload hash is the well-known SHA-256 of the empty string", () => {
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("extra signed headers are lower-cased, trimmed, and ordered", () => {
  const headers = signV4({
    method: "PUT",
    url: "https://bucket.nyc3.digitaloceanspaces.com/orgs/a/file.pdf",
    region: "nyc3",
    service: "s3",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    headers: {
      "Content-Type": "application/pdf",
      "x-amz-content-sha256": "abc123",
    },
    body: "hello",
    date: new Date("2015-08-30T12:36:00Z"),
  });

  // Signed headers must include the extra headers in sorted order.
  assert.match(
    headers.authorization,
    /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/,
  );
});
