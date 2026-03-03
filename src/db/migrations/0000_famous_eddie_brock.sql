CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"service_type" text NOT NULL,
	"title" text,
	"description" text,
	"bbox" text,
	"layers" jsonb,
	"crs" jsonb,
	"keywords" jsonb,
	"formats" jsonb,
	"extra_meta" jsonb,
	"health_status" text DEFAULT 'unknown',
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"response_time_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_url_source_unique" UNIQUE("url","source_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_harvest_at" timestamp with time zone,
	"last_harvest_status" text,
	"last_harvest_error" text,
	"services_found" integer DEFAULT 0,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_services_service_type" ON "services" USING btree ("service_type");--> statement-breakpoint
CREATE INDEX "idx_services_source_id" ON "services" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_services_health_status" ON "services" USING btree ("health_status");--> statement-breakpoint
CREATE INDEX "idx_services_updated_at" ON "services" USING btree ("updated_at");