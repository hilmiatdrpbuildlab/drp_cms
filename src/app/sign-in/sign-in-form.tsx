"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { authClient } from "@/auth/client";

type Mode = "sign-in" | "sign-up" | "verify" | "forgot" | "reset";
const DOMAIN = "drpbuildlab.com";

const done = () => window.location.assign("/blog"); // full load so the server renders the new session

export function SignInForm() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = (next: Mode, message: string | null = null) => {
    setMode(next);
    setError(null);
    setNotice(message);
    setOtp("");
  };

  async function run(e: FormEvent, fn: () => Promise<void>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // Better Auth returns { data, error } instead of throwing.
  const check = (res: { error?: { message?: string; code?: string; status?: number } | null }) => {
    if (res.error) throw Object.assign(new Error(res.error.message || "Request failed."), { code: res.error.code });
  };

  const companyEmail = email.trim().toLowerCase().endsWith(`@${DOMAIN}`);

  if (mode === "verify" || mode === "reset") {
    const isReset = mode === "reset";
    return (
      <form
        className="space-y-3"
        onSubmit={(e) =>
          run(e, async () => {
            if (isReset) {
              check(await authClient.emailOtp.resetPassword({ email, otp, password }));
              go("sign-in", "Password changed. Sign in with the new password.");
              setPassword("");
            } else {
              check(await authClient.emailOtp.verifyEmail({ email, otp }));
              // Auto sign-in after verification is on; if the session isn't there, sign in with the password we have.
              const session = await authClient.getSession();
              if (!session.data && password) check(await authClient.signIn.email({ email, password }));
              done();
            }
          })
        }
      >
        <Notice>{notice ?? `We sent a code to ${email}. It can take a minute; check your junk folder too.`}</Notice>
        <Field label="Code">
          <input className="field tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" required value={otp} onChange={(e) => setOtp(e.target.value.trim())} autoFocus />
        </Field>
        {isReset && (
          <Field label="New password">
            <input className="field" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy}>
          {isReset ? "Change password" : "Verify and continue"}
        </button>
        <div className="flex justify-between text-xs">
          <button
            type="button"
            className="text-accent hover:underline"
            disabled={busy}
            onClick={async () => {
              setError(null);
              const res = isReset
                ? await authClient.forgetPassword.emailOtp({ email })
                : await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
              if (res.error) setError(res.error.message || "Could not resend.");
              else setNotice(`New code sent to ${email}.`);
            }}
          >
            Send a new code
          </button>
          <button type="button" className="text-zinc-500 hover:underline" onClick={() => go("sign-in")}>
            Back
          </button>
        </div>
      </form>
    );
  }

  if (mode === "forgot") {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) =>
          run(e, async () => {
            check(await authClient.forgetPassword.emailOtp({ email }));
            go("reset", `If ${email} has an account, a reset code is on its way.`);
          })
        }
      >
        <Field label="Work email">
          <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy}>Send reset code</button>
        <button type="button" className="w-full text-xs text-zinc-500 hover:underline" onClick={() => go("sign-in")}>
          Back to sign in
        </button>
      </form>
    );
  }

  const signUp = mode === "sign-up";
  return (
    <form
      className="space-y-3"
      onSubmit={(e) =>
        run(e, async () => {
          if (signUp) {
            if (!companyEmail) throw new Error(`Use your @${DOMAIN} address.`);
            check(await authClient.signUp.email({ email, password, name: name.trim() || email.split("@")[0] }));
            go("verify");
            return;
          }
          const res = await authClient.signIn.email({ email, password });
          if (res.error?.code === "EMAIL_NOT_VERIFIED" || res.error?.status === 403) {
            go("verify"); // a new code was sent on this sign-in attempt
            return;
          }
          check(res);
          done();
        })
      }
    >
      {notice && <Notice>{notice}</Notice>}
      {signUp && (
        <Field label="Your name">
          <input className="field" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <Field label="Work email">
        <input className="field" type="email" autoComplete="email" placeholder={`you@${DOMAIN}`} required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <input
          className="field"
          type="password"
          autoComplete={signUp ? "new-password" : "current-password"}
          minLength={signUp ? 10 : undefined}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary w-full" disabled={busy}>
        {signUp ? "Create account" : "Sign in"}
      </button>
      <div className="flex justify-between text-xs">
        <button type="button" className="text-accent hover:underline" onClick={() => go(signUp ? "sign-in" : "sign-up")}>
          {signUp ? "I have an account" : "First time? Create an account"}
        </button>
        {!signUp && (
          <button type="button" className="text-zinc-500 hover:underline" onClick={() => go("forgot")}>
            Forgot password
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

const Notice = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">{children}</p>
);

const ErrorText = ({ children }: { children: ReactNode }) =>
  children ? <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">{children}</p> : null;
