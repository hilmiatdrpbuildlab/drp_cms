import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent } from "node:https";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

/** Neon object storage (S3-compatible), one private bucket. */
export const MEDIA_BUCKET = "media";

/** Raster images only: SVG can carry script, and the site serves these from its own origin. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Parallel getaddrinfo calls for the storage host intermittently fail with ENOTFOUND on some
// networks (seen on Windows dev machines) while one-at-a-time lookups succeed. Share one in-flight
// lookup per host and keep the answer for a minute.
type Lookup = { at: number; addresses: Promise<LookupAddress[]> };
const lookups = new Map<string, Lookup>();
const DNS_TTL_MS = 60_000;

const cachedLookup: typeof dnsLookup = ((hostname: string, options: unknown, callback: unknown) => {
  const cb = (typeof options === "function" ? options : callback) as (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void;
  const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
  let entry = lookups.get(hostname);
  if (!entry || Date.now() - entry.at > DNS_TTL_MS) {
    entry = {
      at: Date.now(),
      addresses: new Promise((resolve, reject) =>
        dnsLookup(hostname, { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))),
      ),
    };
    entry.addresses.catch(() => lookups.delete(hostname)); // don't cache failures
    lookups.set(hostname, entry);
  }
  entry.addresses.then(
    (addrs) => (all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family)),
    (err) => cb(err, all ? [] : ""),
  );
}) as typeof dnsLookup;

/**
 * Locally, `neon env pull` writes AWS_*. On Netlify those names are reserved by AWS Lambda and can't be
 * set for functions, so production uses NEON_STORAGE_* with the same values.
 */
function storageConfig() {
  const e = process.env;
  const endpoint = e.NEON_STORAGE_ENDPOINT ?? e.AWS_ENDPOINT_URL_S3;
  const accessKeyId = e.NEON_STORAGE_ACCESS_KEY_ID ?? e.AWS_ACCESS_KEY_ID;
  const secretAccessKey = e.NEON_STORAGE_SECRET_ACCESS_KEY ?? e.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Object storage is not configured: set NEON_STORAGE_* (or run `neon env pull` locally). See README.md.");
  }
  return { endpoint, region: e.NEON_STORAGE_REGION ?? e.AWS_REGION ?? "eu-central-1", credentials: { accessKeyId, secretAccessKey } };
}

let client: S3Client | undefined;
function s3() {
  return (client ??= new S3Client({
    ...storageConfig(),
    forcePathStyle: true, // Neon serves buckets as path segments, not subdomains
    requestHandler: new NodeHttpHandler({
      httpsAgent: new Agent({ keepAlive: true, maxSockets: 16, lookup: cachedLookup }),
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
    }),
  }));
}

const isNotFound = (e: unknown) =>
  e instanceof S3ServiceException && (e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata.httpStatusCode === 404);

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

/** The object as a web stream, or null if it doesn't exist. */
export async function getObject(key: string): Promise<{ body: ReadableStream; contentType: string } | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
    if (!res.Body) return null;
    return { body: res.Body.transformToWebStream(), contentType: res.ContentType ?? "application/octet-stream" };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function getObjectBytes(key: string): Promise<Uint8Array | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
    return res.Body ? await res.Body.transformToByteArray() : null;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
}
