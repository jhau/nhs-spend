import crypto from "node:crypto";

type ObjectStorageConfig = {
  endpoint: string; // e.g. https://s3.amazonaws.com or https://<account>.r2.cloudflarestorage.com
  region: string; // e.g. us-east-1 (R2 can be 'auto')
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function getObjectStorageConfig(): ObjectStorageConfig {
  const region =
    env("OBJECT_STORAGE_REGION") ??
    env("S3_REGION") ??
    env("AWS_REGION") ??
    "us-east-1";

  const endpoint =
    env("OBJECT_STORAGE_ENDPOINT") ??
    env("S3_ENDPOINT") ??
    // AWS S3 default endpoint (avoid needing an env var)
    (region === "us-east-1"
      ? "https://s3.amazonaws.com"
      : `https://s3.${region}.amazonaws.com`);
  const bucket = env("OBJECT_STORAGE_BUCKET") ?? env("S3_BUCKET");
  const accessKeyId =
    env("OBJECT_STORAGE_ACCESS_KEY_ID") ??
    env("S3_ACCESS_KEY_ID") ??
    env("AWS_ACCESS_KEY_ID");
  const secretAccessKey =
    env("OBJECT_STORAGE_SECRET_ACCESS_KEY") ??
    env("S3_SECRET_ACCESS_KEY") ??
    env("AWS_SECRET_ACCESS_KEY");

  if (!bucket) {
    throw new Error("Missing OBJECT_STORAGE_BUCKET (or S3_BUCKET)");
  }
  if (!accessKeyId) {
    throw new Error("Missing OBJECT_STORAGE_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID)");
  }
  if (!secretAccessKey) {
    throw new Error(
      "Missing OBJECT_STORAGE_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY)"
    );
  }

  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  // 20251229T123456Z
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const amzDate = iso.slice(0, 15) + "Z";
  const dateStamp = iso.slice(0, 8);
  return { amzDate, dateStamp };
}

function encodeRfc3986(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function canonicalUriPathStyle(bucket: string, objectKey: string): string {
  // Path-style: /bucket/key with each segment encoded.
  const segments = [bucket, ...objectKey.split("/")].map(encodeRfc3986);
  return "/" + segments.join("/");
}

function buildPathStyleUrl(endpoint: string, bucket: string, objectKey: string) {
  const base = endpoint.replace(/\/+$/u, "");
  const path = canonicalUriPathStyle(bucket, objectKey);
  return new URL(base + path);
}

type PresignParams = {
  method: "GET" | "PUT";
  objectKey: string;
  expiresSeconds: number;
};

/**
 * Minimal SigV4 presigner for S3-compatible object storage.
 * Uses path-style URLs: {endpoint}/{bucket}/{key}
 *
 * We only sign the `host` header and use `UNSIGNED-PAYLOAD` for presigned URLs.
 */
export function presignObjectUrl(params: PresignParams): string {
  const cfg = getObjectStorageConfig();
  const now = new Date();
  const { amzDate, dateStamp } = toAmzDate(now);

  const url = buildPathStyleUrl(cfg.endpoint, cfg.bucket, params.objectKey);
  const host = url.host;
  const canonicalUri = url.pathname;

  const algorithm = "AWS4-HMAC-SHA256";
  const service = "s3";
  const scope = `${dateStamp}/${cfg.region}/${service}/aws4_request`;
  const credential = `${cfg.accessKeyId}/${scope}`;
  const signedHeaders = "host";

  const query: Record<string, string> = {
    "X-Amz-Algorithm": algorithm,
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(params.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    algorithm,
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + cfg.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  url.search = canonicalQuery + `&X-Amz-Signature=${signature}`;
  return url.toString();
}

/**
 * Checks if an object exists in storage by sending a HEAD request.
 * Uses a presigned URL.
 */
export async function checkObjectExists(objectKey: string): Promise<boolean> {
  try {
    const url = presignObjectUrl({
      method: "GET",
      objectKey,
      expiresSeconds: 60,
    });
    const resp = await fetch(url, { method: "HEAD" });
    return resp.ok;
  } catch (err) {
    console.error(`Error checking object existence for ${objectKey}:`, err);
    return false;
  }
}

