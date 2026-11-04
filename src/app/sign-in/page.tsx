import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getStaff } from "@/auth/server";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic"; // reads the session cookie

export default async function SignInPage() {
  if (await getStaff()) redirect("/blog");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">DRP Build Lab</p>
        <h1 className="mt-1 mb-5 text-xl font-semibold">Team CMS</h1>
        <SignInForm />
      </div>
    </main>
  );
}
