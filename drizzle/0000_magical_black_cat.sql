CREATE TABLE "generated_tafsir_cache" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"surah" integer NOT NULL,
	"ayah" integer NOT NULL,
	"verse_key" varchar(16) NOT NULL,
	"tafsir_id" integer NOT NULL,
	"tafsir_name" text NOT NULL,
	"tafsir_author" text NOT NULL,
	"tafsir_slug" text,
	"language" text NOT NULL,
	"original_tafsir" text NOT NULL,
	"source_tafsir_plain" text NOT NULL,
	"explained_tafsir" text NOT NULL,
	"arabic_text" text,
	"translation_text" text,
	"translation_id" integer,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"additional_context" text,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tafsir_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"surah" integer NOT NULL,
	"ayah" integer NOT NULL,
	"verse_key" varchar(16) NOT NULL,
	"tafsir_id" integer NOT NULL,
	"user_complaint" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"corrected_tafsir" text,
	"original_explained" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "generated_tafsir_cache_surah_ayah_tafsir_id_idx" ON "generated_tafsir_cache" USING btree ("surah","ayah","tafsir_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_tafsir_cache_source_hash_idx" ON "generated_tafsir_cache" USING btree ("source_hash");--> statement-breakpoint
CREATE INDEX "generated_tafsir_cache_verse_key_idx" ON "generated_tafsir_cache" USING btree ("verse_key");--> statement-breakpoint
CREATE INDEX "generated_tafsir_cache_tafsir_id_idx" ON "generated_tafsir_cache" USING btree ("tafsir_id");--> statement-breakpoint
CREATE INDEX "tafsir_flags_verse_key_idx" ON "tafsir_flags" USING btree ("verse_key");--> statement-breakpoint
CREATE INDEX "tafsir_flags_status_idx" ON "tafsir_flags" USING btree ("status");