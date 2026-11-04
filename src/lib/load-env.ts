// For CLI tools (drizzle-kit). Next.js loads .env.local by itself.
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

// pg treats sslmode=require as verify-full but warns about it; say verify-full explicitly.
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
  const v = process.env[key];
  if (v?.includes("sslmode=require")) process.env[key] = v.replace("sslmode=require", "sslmode=verify-full");
}
