CREATE TYPE "public"."offer_status" AS ENUM('draft', 'sending', 'sent');--> statement-breakpoint
CREATE TABLE "article_clicks" (
	"email" text NOT NULL,
	"slug" text NOT NULL,
	"clicks" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_clicks_email_slug_pk" PRIMARY KEY("email","slug")
);
--> statement-breakpoint
CREATE TABLE "offer_consent_requests" (
	"email" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"sent_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_consents" (
	"email" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"opted_in" boolean NOT NULL,
	"version" text,
	"consented_at" timestamp (3) with time zone,
	"source" text,
	"synced_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"partner" text DEFAULT '' NOT NULL,
	"audience_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp (3) with time zone,
	"sent_by" text
);
