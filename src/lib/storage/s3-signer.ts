import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature V4 signer (dependency-free) for S3-compatible object
 * stores such as DigitalOcean Spaces. Only what the storage adapter needs:
 * single-request signing of PUT / GET / DELETE with an in-memory body.
 *
 * Verified against the AWS `get-vanilla` test vector in s3-signer.test.ts.
 */

export type SignInput = {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  /** Full request URL, e.g. https://bucket.nyc3.digitaloceanspaces.com/key */
  url: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Extra headers to sign (host + x-amz-date are added automatically). */
  headers?: Record<string, string>;
  /** Request body; "" for bodyless requests. */
  body?: Buffer | string;
  /** Override the signing time (tests). Defaults to now. */
  date?: Date;
};

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding; preserves unreserved chars only. */
function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUri(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  return pathname
    .split("/")
    .map((seg) => encodeRfc3986(decodeURIComponent(seg)))
    .join("/");
}

function amzDates(date: Date): { amzDate: string; dateStamp: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Returns the headers to attach to the request, including Authorization and
 * x-amz-date. Only the headers passed in (plus host + x-amz-date) are signed —
 * the S3 adapter passes `x-amz-content-sha256` explicitly so it is signed as
 * S3 requires, while the generic AWS test vector omits it.
 */
export function signV4(input: SignInput): Record<string, string> {
  const url = new URL(input.url);
  const body = input.body ?? "";
  const payloadHash = sha256Hex(body);
  const { amzDate, dateStamp } = amzDates(input.date ?? new Date());

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-date": amzDate,
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        v.trim(),
      ]),
    ),
  };

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalQuery = [...url.searchParams.entries()]
    .map(
      ([k, v]) =>
        [encodeRfc3986(k), encodeRfc3986(v)] as [string, string],
    )
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    input.method,
    canonicalUri(url.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(
      hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region),
      input.service,
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...headers, authorization };
}
