CREATE TYPE "public"."comment_status" AS ENUM('pending', 'approved');--> statement-breakpoint
CREATE TABLE "blog_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"status" "comment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"moderated_at" timestamp (3) with time zone,
	"moderated_by" text
);
--> statement-breakpoint
CREATE TABLE "blog_likes" (
	"slug" text NOT NULL,
	"visitor" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_likes_slug_visitor_pk" PRIMARY KEY("slug","visitor")
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "published_rev" text;--> statement-breakpoint
CREATE INDEX "blog_comments_slug_idx" ON "blog_comments" USING btree ("slug","status","created_at");--> statement-breakpoint
CREATE INDEX "blog_comments_status_idx" ON "blog_comments" USING btree ("status","created_at");