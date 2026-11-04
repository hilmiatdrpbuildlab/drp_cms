import type { NextRequest } from "next/server";

import { getAuth } from "@/auth/server";

let middleware: ReturnType<ReturnType<typeof getAuth>["middleware"]> | undefined;

// Sends signed-out page loads to /sign-in and refreshes sessions. Not the security boundary:
// pages, actions and API routes check getStaff() themselves.
export default function proxy(request: NextRequest) {
  if (request.headers.has("next-action")) return;
  middleware ??= getAuth().middleware({ loginUrl: "/sign-in" });
  return middleware(request);
}

export const config = {
  matcher: ["/((?!api/|sign-in|no-access|_next/|favicon.ico|robots.txt).*)"],
};
