import ollamaClient from '../clients/ollamaClient';
import extract from 'extract-json-from-string';

export async function generateExplanation(tafseerText, verse) {
	const schema = {
		explanation: 'string',
		keyTerms: '{term: string, definition: string}[]',
	};
	// const query = `Rephrase the following tafseer in formal and modern language that is suitable for a general audience:${tafseerText}
	// Avoid using slang or colloquial expressions. In your explanation,
	// you should fetch important points and summarize them clearly. You should also define the key terms of english and Islamic used in the response.
	// you have to follow this schema strictly:
	// {
	//     explanation: string,
	//     keyTerms: {term: string, definition: string}[],
	// }
	// `;
	const query = `
    Rephrase the following tafseer in clear, simple, and concise language for a general audience:
    ${tafseerText}
    Guidelines:
    Keep the tone formal but simple (not technical or slang).
    Preserve the original meaning and context.
    Organize the explanation using clear headings, subheadings, and bullet points.
    Highlight and clearly summarize the important points.
    Define key too formal English words and Islamic terms used in the explanation.
    Add a short final summary covering the main ideas.
    Strictly follow this output schema:
    {
    explanation: string,
    keyTerms: { term: string, definition: string }[]
    }
    `;

	const response = await ollamaClient.invoke([
		{
			role: 'system',
			content: `You are a teacher who explains Quranic tafseer in simple formal language, not too friendly nor too technical. You always respond in JSON format according to the given schema: ${JSON.stringify(schema)}`,
		},
		{
			role: 'user',
			content: query,
		},
	]);

	return extract(response?.content)[0];
}
