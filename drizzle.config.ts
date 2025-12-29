import dotenv from "dotenv";

// Load .env first, then .env.local overrides (if exists)
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Please add it to your environment (e.g. in a .env file).");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});

