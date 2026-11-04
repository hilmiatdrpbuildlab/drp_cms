import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { getStaff } from "@/auth/server";
import { slugify } from "@/lib/blog/contract";
import { mediaUrl } from "@/lib/blog/publish-plan";
import { getDb } from "@/lib/db";
import { media, posts } from "@/lib/schema";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, putObject } from "@/lib/storage";

// The first bytes of each allowed format, so a renamed file can't pass as an image.
function sniff(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "image/avif";
  return null;
}

/** Upload one image for a post. multipart/form-data: file, postId. */
export async function POST(request: Request) {
  const staff = await getStaff();
  if (!staff) return Response.json({ error: "Not signed in" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const postId = z.uuid().safeParse(form?.get("postId"));
  if (!(file instanceof File) || !postId.success) return Response.json({ error: "Expected a file and a postId" }, { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "Images can be at most 5 MB" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  const ext = type && ALLOWED_IMAGE_TYPES[type];
  if (!type || !ext) return Response.json({ error: "Use PNG, JPEG, WebP, AVIF or GIF" }, { status: 415 });

  const db = getDb();
  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId.data));
  if (!post) return Response.json({ error: "Article not found" }, { status: 404 });

  const base = slugify(file.name.replace(/\.[^.]+$/, "")).slice(0, 50) || "image";
  const key = `posts/${post.id}/${randomBytes(4).toString("hex")}-${base}.${ext}`;
  try {
    await putObject(key, bytes, type);
  } catch (e) {
    console.error("[media] upload failed", key, e);
    return Response.json({ error: "Storage didn't accept the upload. Try again in a moment." }, { status: 502 });
  }
  await db.insert(media).values({
    key,
    postId: post.id,
    filename: file.name.slice(0, 200),
    contentType: type,
    size: bytes.byteLength,
    uploadedBy: staff.email,
  });
  return Response.json({ key, url: mediaUrl(key) }, { status: 201 });
}
