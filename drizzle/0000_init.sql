CREATE TYPE "public"."post_category" AS ENUM('technical', 'partner', 'collab');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"post_id" uuid,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"category" "post_category" DEFAULT 'technical' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"langs" text[] DEFAULT '{en,nl,fr}'::text[] NOT NULL,
	"author_name" text DEFAULT '' NOT NULL,
	"date" text,
	"cover_key" text,
	"cover_alt" text DEFAULT '' NOT NULL,
	"video" jsonb,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"published_slug" text,
	"published_at" timestamp with time zone,
	"published_by" text,
	"published_commit" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_post_id_idx" ON "media" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "posts_updated_at_idx" ON "posts" USING btree ("updated_at");