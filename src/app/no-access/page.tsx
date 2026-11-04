import { SignOutButton } from "@/components/sign-out-button";

export default function NoAccess() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-sm rounded-xl border border-zinc-200 bg-white p-6 text-sm shadow-sm">
        <h1 className="mb-2 text-lg font-semibold">No access</h1>
        <p className="mb-4 text-zinc-600">
          This tool is for the DRP Build Lab team. Sign in with your verified @drpbuildlab.com address.
        </p>
        <SignOutButton className="btn-secondary" />
      </div>
    </main>
  );
}
