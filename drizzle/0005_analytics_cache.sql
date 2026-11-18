CREATE TABLE "analytics_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp (3) with time zone NOT NULL
);
