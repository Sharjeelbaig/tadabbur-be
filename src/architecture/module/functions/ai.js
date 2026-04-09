import ollamaClient, {jsonParser} from '../clients/ollamaClient';
import { getOrGenerateTafseer } from '../clients/dbClient';

/**
 * Attempts to repair malformed JSON by closing unterminated strings
 * @param {string} jsonStr - The potentially malformed JSON string
 * @returns {object|null} - Parsed JSON object or null if repair fails
 */
function attemptJsonRepair(jsonStr) {
	try {
		return JSON.parse(jsonStr);
	} catch (e) {
		// Try to repair unterminated string
		const unterminatedStringMatch = e.message.match(/Unterminated string|Unexpected end of JSON|position (\d+)/);
		if (!unterminatedStringMatch) return null;
		
		// Try closing the string and object
		let repaired = jsonStr.trim();
		
		// Count open vs close quotes to detect unclosed strings
		const openQuotes = (repaired.match(/(?<!\\)"/g) || []).length;
		if (openQuotes % 2 !== 0) {
			// Odd number of quotes means unclosed string
			repaired += '"';
		}
		
		// Try to close any unclosed arrays/objects
		let openBraces = (repaired.match(/{/g) || []).length;
		let closeBraces = (repaired.match(/}/g) || []).length;
		let openBrackets = (repaired.match(/\[/g) || []).length;
		let closeBrackets = (repaired.match(/]/g) || []).length;
		
		while (openBraces > closeBraces) {
			repaired += '}';
			closeBraces++;
		}
		while (openBrackets > closeBrackets) {
			repaired += ']';
			closeBrackets++;
		}
		
		try {
			return JSON.parse(repaired);
		} catch {
			return null;
		}
	}
}

/**
 * Extracts JSON from markdown code blocks if present
 * @param {string} text - The text that may contain JSON in code blocks
 * @returns {string} - Extracted JSON or original text
 */
function extractJsonFromMarkdown(text) {
	// Try to extract JSON from markdown code blocks
	const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonBlockMatch) {
		return jsonBlockMatch[1].trim();
	}
	
	// Try to find JSON object in the text
	const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
	if (jsonObjectMatch) {
		return jsonObjectMatch[0];
	}
	
	return text;
}

export async function generateExplanation(tafseerText, verse, tafseerAuthor) {
	const suggestedPrompt = 'What does this verse say?';
	const buildVerseChatFallback = (message, error, details) => ({
		explanation: [
			'# Explainer unavailable right now',
			'-> The structured tafsir explainer could not be prepared for this ayah at the moment.',
			`-> You can still use grounded verse chat and ask: "${suggestedPrompt}"`,
			'-> Verse chat answers from the current ayah and the selected tafsir, so you still have a usable explanation path.',
			'# Summary',
			'-> The explainer is unavailable for now.',
			'-> Use verse chat as the fallback for this ayah.',
		].join('\n'),
		keyTerms: [],
		fallbackMode: 'verse_chat',
		suggestedPrompt,
		error,
		details: details || message,
	});

    // Use the caching layer to check for existing tafseer first
    return await getOrGenerateTafseer(tafseerText, verse, tafseerAuthor, async () => {
	const schema = {
		explanation: 'string',
		keyTerms: '{term: string, definition: string}[]',
	};
	const authorLabel = tafseerAuthor || 'The scholar';
	const verseLabel = verse || 'the verse';
	const query = `
You are given a tafseer (Quranic commentary) by ${authorLabel} on ${verseLabel}. Your ONLY task is to REFORMAT it — do NOT change, add, or remove any meaning, ruling, or interpretation.

When referring to the scholar in the explanation, use their name: "${authorLabel} said..." or "According to ${authorLabel}..."
When referring to the verse, use: "${verseLabel}"

TAFSEER TO REFORMAT:
${tafseerText}

STRICT FORMATTING RULES — follow exactly:
1. Use "# Heading" for each major topic or section found in the tafseer.
2. Use "-> " (arrow + space) for every individual point, detail, or sub-idea under each heading.
3. Every sentence or idea from the original tafseer MUST appear under some heading as an arrow point.
4. Do NOT skip, merge away, or invent any content. Rephrase only for clarity — meaning stays identical.
5. End with a "# Summary" section that lists the core takeaways as "-> " points.

EXAMPLE FORMAT (structure only — do not copy this content):
# Main Theme
-> First key point from the tafseer.
-> Second key point from the tafseer.

# Another Section
-> Detail from the tafseer.
-> Another detail.

# Summary
-> Core idea one.
-> Core idea two.

After reformatting, also extract key Islamic or formal English terms with their definitions.

IMPORTANT: Respond ONLY with valid JSON. No markdown code blocks, no extra text outside JSON.
Use this exact schema:
{
	"explanation": "your fully formatted explanation here (use \\n for newlines)",
	"keyTerms": [{"term": "word", "definition": "meaning"}]
}

Rules for valid JSON:
- All strings must be properly quoted with double quotes
- Escape any internal double quotes with backslash: \\"
- Use \\n for newlines inside the explanation string
- No trailing commas
- Complete all strings and arrays before closing
`;

	const maxRetries = 2;
	let lastError = null;
	
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const rawResponse = await ollamaClient.invoke([
				{
					role: 'system',
					content: `You are a formatter of Quranic tafseer. Your sole job is to REFORMAT — not rewrite, not interpret, not alter — the given tafseer into structured headings (#) and arrow points (->), preserving every meaning exactly as given. You ALWAYS respond with ONLY valid JSON — no markdown, no code blocks, no text outside JSON. Schema: {"explanation": "string with \\n newlines", "keyTerms": [{"term": "string", "definition": "string"}]}`,
				},
				{
					role: 'user',
					content: query,
				},
			]);

			// Get the text content from the response
			const responseText = typeof rawResponse === 'string' 
				? rawResponse 
				: rawResponse.content || JSON.stringify(rawResponse);
			
			// Extract JSON from markdown if present
			const jsonStr = extractJsonFromMarkdown(responseText);
			
			// Try to parse, with repair attempt
			const parsed = attemptJsonRepair(jsonStr);
			if (parsed && typeof parsed === 'object') {
				return parsed;
			}
			
			// If repair failed, throw to trigger retry
			throw new Error('Failed to parse JSON response');
			
		} catch (error) {
			lastError = error;
			console.error(`Attempt ${attempt + 1} failed:`, error.message);
			
			// On last attempt, return a fallback response
			if (attempt === maxRetries) {
				console.error('All retry attempts failed, returning fallback response');
				return buildVerseChatFallback(
					lastError?.message || 'Failed to generate proper JSON response from AI model',
					'Failed to generate proper JSON response from AI model',
					lastError?.message,
				);
			}
		}
	}
	
	// This should not be reached, but just in case
		return buildVerseChatFallback(
			'Unexpected error in generateExplanation',
			'Unexpected error in generateExplanation',
		);
	});
}

/**
 * Attempts to correct a previously generated explanation based on a user complaint.
 * Evaluates the complaint against the source text to see if it's valid before modifying.
 * 
 * @param {string} originalExplanation - The previously generated explanation that the user flagged
 * @param {string} userComplaint - The user's description of what is wrong
 * @param {string} sourceText - The original source tafseer text
 * @param {string} verse - The verse identifier
 * @param {string} tafseerAuthor - The tafseer author
 * @returns {Promise<object>} Corrected or evaluated explanation
 */
export async function correctTafsir(originalExplanation, userComplaint, sourceText, verse, tafseerAuthor) {
	const authorLabel = tafseerAuthor || 'The scholar';
	const verseLabel = verse || 'the verse';
	
	const query = `
You previously generated a reformatted explanation of a tafseer by ${authorLabel} for ${verseLabel}.
A user has reported an issue with your explanation.

YOUR TASK:
1. Evaluate if the user's complaint is valid by comparing it against the SOURCE TAFSEER.
2. If the user is correct (e.g. you missed a point, hallucinated something, or mistranslated), produce a NEW CORRECTED explanation incorporating the fix.
3. If the user's complaint contradicts the source tafseer or is just their personal opinion, keep your original explanation but add a note.

SOURCE TAFSEER:
${sourceText}

YOUR ORIGINAL EXPLANATION:
${originalExplanation}

USER COMPLAINT:
${userComplaint}

STRICT FORMATTING RULES (same as before):
1. Use "# Heading" for each major topic or section.
2. Use "-> " (arrow + space) for every individual point.
3. End with a "# Summary" section.
4. Extract key terms.

Respond ONLY with valid JSON exactly matching this schema:
{
	"isValidComplaint": boolean, 
	"correctionReasoning": "Briefly explain if you made a change and why based on the source text",
	"explanation": "your fully formatted explanation here (use \\n for newlines)",
	"keyTerms": [{"term": "word", "definition": "meaning"}]
}
`;

	const maxRetries = 2;
	let lastError = null;
	
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const rawResponse = await ollamaClient.invoke([
				{
					role: 'system',
					content: `You are an expert reviewer of Quranic tafseer formatting. You only output valid JSON. Schema: {"isValidComplaint": boolean, "correctionReasoning": "string", "explanation": "string with \\n newlines", "keyTerms": [{"term": "string", "definition": "string"}]}`,
				},
				{
					role: 'user',
					content: query,
				},
			]);

			const responseText = typeof rawResponse === 'string' 
				? rawResponse 
				: rawResponse.content || JSON.stringify(rawResponse);
			
			const jsonStr = extractJsonFromMarkdown(responseText);
			const parsed = attemptJsonRepair(jsonStr);
			
			if (parsed && typeof parsed === 'object') {
				return parsed;
			}
			throw new Error('Failed to parse JSON response');
			
		} catch (error) {
			lastError = error;
			console.error(`Attempt ${attempt + 1} failed:`, error.message);
			
			if (attempt === maxRetries) {
				return {
					isValidComplaint: false,
					correctionReasoning: "Failed to process the correction request.",
					explanation: originalExplanation, // Fallback to original
					keyTerms: [],
					error: 'Failed to generate proper JSON response from model',
					details: lastError?.message
				};
			}
		}
	}
	
	return {
		isValidComplaint: false,
		explanation: originalExplanation,
		error: 'Unexpected error in correctTafsir'
	};
}
