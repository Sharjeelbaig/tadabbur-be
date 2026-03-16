import { integer, pgTable, text, timestamp, varchar, bigserial, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const generatedTafsirCache = pgTable(
  'generated_tafsir_cache',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    surah: integer('surah').notNull(),
    ayah: integer('ayah').notNull(),
    verseKey: varchar('verse_key', { length: 16 }).notNull(),
    tafsirId: integer('tafsir_id').notNull(),
    tafsirName: text('tafsir_name').notNull(),
    tafsirAuthor: text('tafsir_author').notNull(),
    tafsirSlug: text('tafsir_slug'),
    language: text('language').notNull(),
    originalTafsir: text('original_tafsir').notNull(),
    sourceTafsirPlain: text('source_tafsir_plain').notNull(),
    explainedTafsir: text('explained_tafsir').notNull(),
    arabicText: text('arabic_text'),
    translationText: text('translation_text'),
    translationId: integer('translation_id'),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    additionalContext: text('additional_context'),
    sourceHash: text('source_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
  },
  (table) => [
    uniqueIndex('generated_tafsir_cache_surah_ayah_tafsir_id_idx').on(table.surah, table.ayah, table.tafsirId),
    uniqueIndex('generated_tafsir_cache_source_hash_idx').on(table.sourceHash),
    index('generated_tafsir_cache_verse_key_idx').on(table.verseKey),
    index('generated_tafsir_cache_tafsir_id_idx').on(table.tafsirId),
  ],
);

export const tafsirFlags = pgTable(
  'tafsir_flags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    surah: integer('surah').notNull(),
    ayah: integer('ayah').notNull(),
    verseKey: varchar('verse_key', { length: 16 }).notNull(),
    tafsirId: integer('tafsir_id').notNull(),
    userComplaint: text('user_complaint').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'), // pending, auto_corrected, manually_reviewed
    correctedTafsir: text('corrected_tafsir'),
    originalExplained: text('original_explained').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
  },
  (table) => [
    index('tafsir_flags_verse_key_idx').on(table.verseKey),
    index('tafsir_flags_status_idx').on(table.status),
  ],
);
