"use client";

import { useFormStatus } from "react-dom";

/** Submit button for the "new article" form: greyed out with a spinner while the draft is created. */
export function NewArticleButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary min-w-36" disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Creating…
        </>
      ) : (
        "New article"
      )}
    </button>
  );
}
