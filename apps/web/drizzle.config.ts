import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";

const isProduction = process.env.NODE_ENV === "production";
dotenv.config({ path: isProduction ? ".env.production" : ".env.local" });

export default {
	schema: "./src/lib/db/schema.ts",
	dialect: "postgresql",
	migrations: {
		table: "drizzle_migrations",
	},
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "",
	},
	out: "./migrations",
	strict: isProduction,
} satisfies Config;
