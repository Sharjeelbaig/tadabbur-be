import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, desc, and, or } from 'drizzle-orm';
import { generatedTafsirCache, tafsirFlags } from '../db/schema.js';

/**
 * Create and initialize the database connection
 * @returns {Promise<import('drizzle-orm/neon-http').DrizzleD1Database>} Database instance
 */
export async function createDbClient() {
    const sql = neon(process.env.DATABASE_URL);
    return drizzle(sql);
}

/**
 * Generate a unique cache key from tafseer text and metadata
 * @param {string} tafseerText - The original tafseer text
 * @param {string} verse - The verse identifier
 * @param {string} tafseerAuthor - The tafseer author
 * @returns {string} Unique hash key
 */
export function generateCacheKey(tafseerText, verse, tafseerAuthor) {
    const content = `${tafseerText}|${verse}|${tafseerAuthor}`;
    // Simple string hash that works for any length
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return `hash_${Math.abs(hash).toString(36)}_${content.length}`;
}

/**
 * Get cached tafseer from the database
 * @param {string} cacheKey - The cache key to look up
 * @param {string} verse - The verse key
 * @param {string} tafseerAuthor - The tafseer author name
 * @returns {Promise<object|null>} Cached tafseer or null if not found
 */
export async function getCachedTafseer(cacheKey, verse, tafseerAuthor) {
    const db = await createDbClient();
    
    // Check by verse and author first (this catches prepopulated rows that used a different hash or any cached ones)
    let results = [];
    if (verse && tafseerAuthor) {
        results = await db.select()
            .from(generatedTafsirCache)
            .where(and(
                eq(generatedTafsirCache.verseKey, verse),
                or(
                    eq(generatedTafsirCache.tafsirAuthor, tafseerAuthor),
                    eq(generatedTafsirCache.tafsirName, tafseerAuthor)
                )
            ));
    }
    
    // Fallback to strict hash check if not found
    if (results.length === 0) {
        results = await db.select()
            .from(generatedTafsirCache)
            .where(eq(generatedTafsirCache.sourceHash, cacheKey));
    }
    
    if (results.length > 0) {
        const record = results[0];
        return {
            explanation: record.explainedTafsir,
            keyTerms: JSON.parse(record.additionalContext || '[]'),
            cached: true,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt
        };
    }
    
    return null;
}

/**
 * Save tafseer to the database cache
 * @param {string} cacheKey - The cache key for the tafseer
 * @param {string} tafseerText - The original tafseer text
 * @param {string} verse - The verse identifier
 * @param {string} tafseerAuthor - The tafseer author
 * @param {object} generatedResult - The AI-generated result
 * @returns {Promise<object>} The saved record
 */
export async function saveTafseerToCache(cacheKey, tafseerText, verse, tafseerAuthor, generatedResult) {
    const db = await createDbClient();
    
    // Parse surah and ayah from verse key (e.g., "2:255" -> surah=2, ayah=255)
    let surah = 0;
    let ayah = 0;
    if (verse && verse.includes(':')) {
        const [surahStr, ayahStr] = verse.split(':');
        surah = parseInt(surahStr, 10) || 0;
        ayah = parseInt(ayahStr, 10) || 0;
    }
    
    const record = await db.insert(generatedTafsirCache)
        .values({
            surah,
            ayah,
            verseKey: verse || 'unknown',
            tafsirId: 0,
            tafsirName: 'ollama',
            tafsirAuthor: tafseerAuthor || 'unknown',
            tafsirSlug: 'ollama',
            language: 'en',
            originalTafsir: tafseerText,
            sourceTafsirPlain: tafseerText,
            explainedTafsir: generatedResult.explanation,
            arabicText: null,
            translationText: null,
            translationId: null,
            model: 'gpt-oss:120b-cloud',
            promptVersion: 'v1',
            additionalContext: JSON.stringify(generatedResult.keyTerms || []),
            sourceHash: cacheKey
        })
        .onConflictDoUpdate({
            target: [generatedTafsirCache.sourceHash],
            set: {
                explainedTafsir: generatedResult.explanation,
                additionalContext: JSON.stringify(generatedResult.keyTerms || []),
            }
        })
        .returning();
    
    return record[0];
}

/**
 * Check if tafseer exists in cache and return it, or generate new tafseer and cache it
 * @param {string} tafseerText - The original tafseer text
 * @param {string} verse - The verse identifier
 * @param {string} tafseerAuthor - The tafseer author
 * @param {Function} generateFunction - Function to generate new tafseer if not cached
 * @returns {Promise<object>} Tafseer result (from cache or newly generated)
 */
export async function getOrGenerateTafseer(tafseerText, verse, tafseerAuthor, generateFunction) {
    const cacheKey = generateCacheKey(tafseerText, verse, tafseerAuthor);
    
    try {
        // First, check if there's an auto-corrected version from user reports
        if (verse) {
            const correctedResult = await getCorrectedTafsir(verse);
            if (correctedResult) {
                console.log('Returning corrected tafseer from flag');
                return correctedResult;
            }
        }
        
        // Check if we have a cached version
        const cachedResult = await getCachedTafseer(cacheKey, verse, tafseerAuthor);
        if (cachedResult) {
            console.log('Returning cached tafseer from NeonDB');
            return cachedResult;
        }
    } catch (cacheError) {
        console.error('Failed to check cache:', cacheError);
        // Continue to generate new tafseer if cache check fails
    }
    
    // Generate new tafseer
    console.log('Generating new tafseer');
    const generatedResult = await generateFunction();
    
    // Try to cache the result if generation was successful
    if (generatedResult.explanation && !generatedResult.error) {
        try {
            await saveTafseerToCache(cacheKey, tafseerText, verse, tafseerAuthor, generatedResult);
            generatedResult.cached = false;
        } catch (cacheError) {
            console.error('Failed to cache tafseer:', cacheError);
            // Continue with generated result even if caching fails
        }
    }
    
	return generatedResult;
}

/**
 * Save a user complaint/flag for a specific tafseer explanation
 * @param {string} verseKey - The verse identifier
 * @param {string} tafseerAuthor - The tafseer author
 * @param {string} originalExplanation - The explanation the user saw
 * @param {string} userComplaint - The user's complaint
 * @param {object} correctionResult - Optional correction from AI (contains isValidComplaint, explanation, etc.)
 * @returns {Promise<object>} The saved flag record
 */
export async function saveTafsirFlag(verseKey, tafseerAuthor, originalExplanation, userComplaint, correctionResult = null) {
	const db = await createDbClient();
	
	let status = 'pending';
	let correctedTafsir = null;
	
	if (correctionResult) {
		if (correctionResult.isValidComplaint && correctionResult.explanation !== originalExplanation) {
			status = 'auto_corrected';
			correctedTafsir = correctionResult.explanation;
			
			// -> Replace the older in the DB (generated_tafsir_cache)
			try {
			    await db.update(generatedTafsirCache)
			        .set({
			            explainedTafsir: correctedTafsir,
			            additionalContext: JSON.stringify(correctionResult.keyTerms || []),
			            updatedAt: new Date().toISOString()
			        })
			        .where(
			            and(
			                eq(generatedTafsirCache.verseKey, verseKey),
			                or(
			                    eq(generatedTafsirCache.tafsirAuthor, tafseerAuthor),
			                    eq(generatedTafsirCache.tafsirName, tafseerAuthor)
			                )
			            )
			        );
			} catch (updateError) {
			    console.error('Failed to replace older in DB:', updateError);
			}
			
		} else {
			status = 'manually_reviewed'; // If AI deemed it invalid or couldn't fix it
		}
	}
	
	const record = await db.insert(tafsirFlags)
		.values({
			surah: 0,
			ayah: 0,
			verseKey: verseKey || 'unknown',
			tafsirId: 0, // Not perfectly matching frontend's integer IDs but okay for this cache layer
			userComplaint: userComplaint,
			status: status,
			correctedTafsir: correctedTafsir,
			originalExplained: originalExplanation,
		})
		.returning();
		
	return record[0];
}

/**
 * Check if there is an auto-corrected tafseer flag for this verse
 * @param {string} verseKey - The verse identifier
 * @param {string} tafseerAuthor - The tafseer author
 * @returns {Promise<object|null>} The corrected explanation if it exists
 */
export async function getCorrectedTafsir(verseKey) {
	const db = await createDbClient();
	const results = await db.select()
		.from(tafsirFlags)
		.where(eq(tafsirFlags.verseKey, verseKey))
		// We could filter by tafsir_id if we have it, but verseKey + author is what we use in this layer
		.orderBy(desc(tafsirFlags.createdAt))
		.limit(1);
		
	if (results.length > 0 && results[0].status === 'auto_corrected') {
		return {
			explanation: results[0].correctedTafsir,
			cached: true,
			isCorrected: true
		};
	}
	
	return null;
}
