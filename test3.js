import crypto from 'crypto';
import { createDbClient } from './src/architecture/module/clients/dbClient.js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    const db = await createDbClient();
    const rows = await db.execute('SELECT id, verse_key, tafsir_author, source_hash, original_tafsir FROM generated_tafsir_cache LIMIT 1;');
    const row = rows.rows[0];
    const hash1 = crypto.createHash('sha256').update(row.original_tafsir).digest('hex');
    console.log('DB hash:', row.source_hash);
    console.log('SHA256(tafseerText):', hash1);
    console.log('Match?', hash1 === row.source_hash);
}
main().catch(console.error);
