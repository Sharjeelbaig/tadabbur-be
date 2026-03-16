import { createDbClient, getCachedTafseer } from './src/architecture/module/clients/dbClient.js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    console.log("Testing getCachedTafseer for 1:1...");
    // A completely fake cacheKey that will miss
    const cacheKey = "fake_cache_key_999";
    const verseKey = "1:1";
    const tafseerAuthor = "Hafiz Ibn Kathir";

    const cached = await getCachedTafseer(cacheKey, verseKey, tafseerAuthor);
    if (cached) {
        console.log("✅ Success! Found cached item via verseKey and tafseerAuthor. Explanation length:", cached.explanation.length);
    } else {
        console.log("❌ Failed to find cached item.");
    }
}
main().catch(console.error);
