import { z } from "zod";

const browserEnvFallback =
	typeof window !== "undefined"
		? {
				CLIPFORGE_MODE: "local",
				NODE_ENV: "development",
				NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
			}
		: {};
const env = {
	...browserEnvFallback,
	...process.env,
};
const isLocalMode = env.CLIPFORGE_MODE === "local";

const optionalInLocal = <T extends z.ZodTypeAny>(schema: T) =>
	isLocalMode ? schema.optional() : schema;

const webEnvSchema = z.object({
	// Node
	NODE_ENV: z.enum(["development", "production", "test"]),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

	// Mode
	CLIPFORGE_MODE: z.enum(["cloud", "local"]).optional().default("cloud"),

	// Public
	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
	NEXT_PUBLIC_MARBLE_API_URL: optionalInLocal(z.url()),

	// Server — required in cloud mode, optional in local mode
	DATABASE_URL: optionalInLocal(
		z
			.string()
			.startsWith("postgres://")
			.or(z.string().startsWith("postgresql://")),
	),

	BETTER_AUTH_SECRET: optionalInLocal(z.string()),
	UPSTASH_REDIS_REST_URL: optionalInLocal(z.url()),
	UPSTASH_REDIS_REST_TOKEN: optionalInLocal(z.string()),
	MARBLE_WORKSPACE_KEY: optionalInLocal(z.string()),
	FREESOUND_CLIENT_ID: optionalInLocal(z.string()),
	FREESOUND_API_KEY: optionalInLocal(z.string()),
	CLOUDFLARE_ACCOUNT_ID: optionalInLocal(z.string()),
	R2_ACCESS_KEY_ID: optionalInLocal(z.string()),
	R2_SECRET_ACCESS_KEY: optionalInLocal(z.string()),
	R2_BUCKET_NAME: optionalInLocal(z.string()),
	MODAL_TRANSCRIPTION_URL: optionalInLocal(z.url()),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const webEnv = webEnvSchema.parse(env);
