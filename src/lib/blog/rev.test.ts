import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { gitBlobSha } from "./rev.ts";

test("matches git hash-object, including non-ASCII text", () => {
  const text = "---\ntitle: Café €499\n---\n\nHello\n";
  const git = execFileSync("git", ["hash-object", "--stdin"], { input: text }).toString().trim();
  assert.equal(gitBlobSha(text), git);
});
