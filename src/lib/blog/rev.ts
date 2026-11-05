/**
 * The git blob SHA of a file's content: what `git hash-object` prints. The CMS stores it for the
 * .md it publishes, and the site's build writes the same hash into the article page
 * (<meta name="drp-rev">), so the CMS can tell when exactly that version is live.
 */
import { createHash } from "node:crypto";

export function gitBlobSha(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
