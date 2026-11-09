import assert from "node:assert/strict";
import { test } from "node:test";

import { activityByTag, activityLabel, type ArticleActivity } from "./activity.ts";

const a = (slug: string, tags: string[], likes: number, comments: number, emailClicks = 0): ArticleActivity => ({
  id: slug,
  slug,
  title: slug,
  tags,
  likes,
  likesLast30Days: 0,
  comments,
  pendingComments: 0,
  emailClicks,
});

test("activityByTag sums per tag, case-insensitively, most active first", () => {
  const tags = activityByTag([a("one", ["AI", "chatbots"], 3, 1), a("two", ["ai", "Ai", "websites"], 0, 0, 2), a("three", [], 9, 9)]);
  assert.deepEqual(tags, [
    { tag: "ai", articles: 2, likes: 3, comments: 1, emailClicks: 2 },
    { tag: "chatbots", articles: 1, likes: 3, comments: 1, emailClicks: 0 },
    { tag: "websites", articles: 1, likes: 0, comments: 0, emailClicks: 2 },
  ]);
});

test("activityLabel says only what there is", () => {
  assert.equal(activityLabel({ likes: 3, comments: 1, emailClicks: 0 }), "3 likes · 1 comment");
  assert.equal(activityLabel({ likes: 0, comments: 0, emailClicks: 1 }), "1 email click");
  assert.equal(activityLabel({ likes: 0, comments: 0, emailClicks: 0 }), "");
});
