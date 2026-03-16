import crypto from 'crypto';
import { createDbClient, generateCacheKey } from './src/architecture/module/clients/dbClient.js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    const db = await createDbClient();
    const rows = await db.execute('SELECT id, verse_key, tafsir_author, source_hash, length(original_tafsir), original_tafsir FROM generated_tafsir_cache LIMIT 1;');
    const row = rows.rows[0];
    const computed = generateCacheKey(row.original_tafsir, row.verse_key, row.tafsir_author);
    console.log('DB verse:', row.verse_key);
    console.log('DB author:', row.tafsir_author);
    console.log('DB hash:', row.source_hash);
    console.log('Computed hash:', computed);
}
main().catch(console.error);
