import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getEnv } from "./env";
import * as schema from "./schema";

// One pool per server process; the globalThis slot survives dev hot reloads.
const slot = globalThis as typeof globalThis & { cmsPool?: Pool };
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  slot.cmsPool ??= new Pool({ connectionString: getEnv().DATABASE_URL, max: 5 });
  return (db ??= drizzle(slot.cmsPool, { schema }));
}
