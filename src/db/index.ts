import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Please configure it before using the database client.");
}

export const pool = new Pool({ connectionString: databaseUrl });

export const db = drizzle(pool, { schema });
export type DbClient = typeof db;

export const closeDb = async () => {
  await pool.end();
};

