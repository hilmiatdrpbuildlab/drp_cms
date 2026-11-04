import { getStaff } from "@/auth/server";
import { getObject } from "@/lib/storage";

/** Serves bucket images to signed-in staff, for the editor preview. The public site never calls this. */
export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  if (!(await getStaff())) return new Response("Not signed in", { status: 401 });
  const key = (await context.params).key.join("/");
  if (!/^posts\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(key)) return new Response("Not found", { status: 404 });

  const file = await getObject(key);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      // Keys never change content (new uploads get a new key), but the response is per-user.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
