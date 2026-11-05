"use client";

import { useTransition } from "react";

import { approveComment, deleteComment, hideComment } from "./actions";

export function CommentActions({ id, status }: { id: string; status: "pending" | "approved" }) {
  const [pending, start] = useTransition();
  const run = (fn: (id: string) => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn(id);
      if (!res.ok) alert(res.error);
    });
  return (
    <div className="ml-auto flex gap-2">
      {status === "pending" ? (
        <button className="btn-primary" disabled={pending} onClick={() => run(approveComment)}>
          ✓ Approve
        </button>
      ) : (
        <button className="btn-secondary" disabled={pending} onClick={() => run(hideComment)}>
          Hide from website
        </button>
      )}
      <button
        className="btn-danger"
        disabled={pending}
        onClick={() => confirm("Delete this comment for good?") && run(deleteComment)}
      >
        Delete
      </button>
    </div>
  );
}
