import ollamaClient from '../clients/ollamaClient';

async function generateExplanationText(tafseerText) {
	const query = `
Rephrase the following tafseer in clear, simple, and concise language for a general audience:
${tafseerText}
Guidelines:
- Keep the tone formal but simple (not technical or slang).
- Preserve the original meaning and context.
- Organize the explanation using clear headings (#), subheadings (###), and bullet points (->).
- Highlight and clearly summarize the important points.
- Add a short final summary covering the main ideas.

Respond with ONLY the explanation text. Do not include any JSON or formatting markers.
	`;

	const response = await ollamaClient.invoke([
		{
			role: 'system',
			content: 'You are a teacher who explains Quranic tafseer in simple formal language, not too friendly nor too technical. You respond with plain text only.',
		},
		{
			role: 'user',
			content: query,
		},
	]);

	return response?.content?.trim() || '';
}

async function generateKeyTerms(explanationText) {
	const query = `
From the following explanation, identify key terms that need definition (formal English words, Islamic terms, or important concepts).

Explanation:
${explanationText}

For each term, provide the term and its definition.
Format each term as: TERM | DEFINITION
Put each term on a new line.
Example:
Tawheed | The Islamic concept of monotheism and the oneness of Allah
Ayah | An Arabic word meaning "sign" or "verse" of the Quran

List 3-7 key terms. Respond with ONLY the list, no additional text.
	`;

	const response = await ollamaClient.invoke([
		{
			role: 'system',
			content: 'You are a teacher who identifies and defines key terms from Islamic texts. You respond with a simple list format only, one term per line.',
		},
		{
			role: 'user',
			content: query,
		},
	]);

	return parseKeyTerms(response?.content || '');
}

function parseKeyTerms(rawText) {
	const lines = rawText.trim().split('\n').filter(line => line.trim());
	const keyTerms = [];

	for (const line of lines) {
		const separatorIndex = line.indexOf('|');
		if (separatorIndex > 0) {
			const term = line.substring(0, separatorIndex).trim();
			const definition = line.substring(separatorIndex + 1).trim();
			if (term && definition) {
				keyTerms.push({ term, definition });
			}
		}
	}

	return keyTerms;
}

export async function generateExplanation(tafseerText, verse) {
	const explanation = await generateExplanationText(tafseerText);
	const keyTerms = await generateKeyTerms(explanation);

	return {
		explanation,
		keyTerms,
	};
}
