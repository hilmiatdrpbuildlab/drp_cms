// drizzle-kit only auto-loads `.env`; this app uses `.env.local` (written by `neon env pull`).
import "./src/lib/load-env";

import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL. Run `neon env pull`.");

export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Neon Auth keeps its users in the `neon_auth` schema; never let drizzle-kit touch it.
  schemaFilter: ["public"],
  dbCredentials: { url },
});
