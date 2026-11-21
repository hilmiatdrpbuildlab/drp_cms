import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getStaff } from "@/auth/server";
import { getSso } from "@/auth/sso-server";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic"; // reads the session cookie

// Codes set by /sso/callback when a Microsoft sign-in is refused.
const SSO_ERRORS: Record<string, string> = {
  sso_expired: "The sign-in took too long or was started in another tab. Try again.",
  sso_denied: "Microsoft sign-in was cancelled or refused.",
  sso_domain: "Use your company Microsoft account (@drpbuildlab.com).",
  sso_failed: "Microsoft sign-in failed. Try again, or use your email and password.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getStaff()) redirect("/blog");
  const sso = Boolean(getSso());
  const { error } = await searchParams;
  const ssoError = error ? SSO_ERRORS[error] : undefined;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">DRP Build Lab</p>
        <h1 className="mt-1 mb-5 text-xl font-semibold">Team CMS</h1>
        {ssoError && (
          <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
            {ssoError}
          </p>
        )}
        {sso && (
          <>
            {/* A plain link: the route redirects to Cloudflare Access, which asks Microsoft only if needed. */}
            <a href="/sso/login?next=/blog" className="btn-primary block w-full text-center">
              Sign in with Microsoft
            </a>
            <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200" />
              or with email and password
              <span className="h-px flex-1 bg-zinc-200" />
            </div>
          </>
        )}
        <SignInForm />
      </div>
    </main>
  );
}
