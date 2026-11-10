import { articleEmailSnapshot } from "@/lib/insights/article-emails-server";

import { ArticleEmailsTable } from "./article-emails-table";

/** The most recent new-article emails, with how many people they reached. Slow-ish: wrapped in Suspense. */
export async function ArticleEmails() {
  let snapshot;
  try {
    snapshot = await articleEmailSnapshot();
  } catch (e) {
    console.error("[insights] article email stats failed", e instanceof Error ? e.message : e);
    return <p className="p-6 text-sm text-red-700">Could not load the email results from Resend. Reload the page to try again.</p>;
  }
  return <ArticleEmailsTable initial={snapshot} />;
}
