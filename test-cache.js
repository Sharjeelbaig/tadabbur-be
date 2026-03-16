import { createDbClient, generateCacheKey } from './src/architecture/module/clients/dbClient.js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    const db = await createDbClient();
    const rows = await db.execute('SELECT id, verse_key, tafsir_author, source_hash, length(original_tafsir) as txt_len, original_tafsir FROM generated_tafsir_cache LIMIT 5;');
    console.log("DB rows:");
    for (const row of rows.rows) {
        console.log(`id:${row.id} verse:${row.verse_key} author:${row.tafsir_author} hash:${row.source_hash} text_len:${row.txt_len}`);
        // Now calculate hash again
        const computed = generateCacheKey(row.original_tafsir, row.verse_key, row.tafsir_author);
        console.log(`Computed: ${computed}  Match: ${computed === row.source_hash}`);
    }
}
main().catch(console.error);
