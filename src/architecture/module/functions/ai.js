import ollamaClient, {jsonParser} from '../clients/ollamaClient';

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

export async function generateExplanation(tafseerText, verse) {
	const schema = {
		explanation: 'string',
		keyTerms: '{term: string, definition: string}[]',
	};
	const query = `
Rephrase the following tafseer in clear, simple, and concise language for a general audience:
${tafseerText}

Guidelines:
- Keep the tone formal but simple (not technical or slang).
- Preserve the original meaning and context.
- Organize the explanation using clear headings (#), subheadings (###), and bullet points (->).
- Highlight and clearly summarize the important points.
- Define key formal English words and Islamic terms used in the explanation.
- Add a short final summary covering the main ideas.

IMPORTANT: Respond ONLY with valid JSON. No markdown, no code blocks, no extra text.
Use this exact schema:
{
	"explanation": "your explanation text here",
	"keyTerms": [{"term": "word", "definition": "meaning"}]
}

Rules for valid JSON:
- All strings must be properly quoted with double quotes
- Escape any quotes inside strings with backslash
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
					content: `You are a teacher who explains Quranic tafseer in simple formal language, not too friendly nor too technical. You ALWAYS respond with ONLY valid JSON - no markdown, no code blocks, no explanation outside JSON. Use this exact schema: {"explanation": "string", "keyTerms": [{"term": "string", "definition": "string"}]}`,
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
				return {
					explanation: 'We apologize, but the explanation could not be generated at this time. Please try again.',
					keyTerms: [],
					error: 'Failed to generate proper JSON response from AI model',
					details: lastError?.message
				};
			}
		}
	}
	
	// This should not be reached, but just in case
	return {
		explanation: 'An unexpected error occurred.',
		keyTerms: [],
		error: 'Unexpected error in generateExplanation'
	};
}
