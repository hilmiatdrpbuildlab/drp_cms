import { getAuth, isStaffEmail } from "@/auth/server";

// The catch-all MUST be named `path`: the Neon Auth handler reads params.path.
type Context = { params: Promise<{ path: string[] }> };
let handlers: ReturnType<ReturnType<typeof getAuth>["handler"]> | undefined;
const h = () => (handlers ??= getAuth().handler());

export const GET = (request: Request, context: Context) => h().GET(request, context);

export async function POST(request: Request, context: Context) {
  const { path } = await context.params;
  // Only company addresses may create an account. (getStaff() checks again on every request.)
  if (path.join("/") === "sign-up/email") {
    const body = (await request.clone().json().catch(() => null)) as { email?: unknown } | null;
    if (typeof body?.email !== "string" || !isStaffEmail(body.email)) {
      return Response.json(
        { code: "DOMAIN_NOT_ALLOWED", message: "Use your company email address to create an account." },
        { status: 403 },
      );
    }
  }
  return h().POST(request, context);
}
