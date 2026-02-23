import ollamaClient, {jsonParser} from '../clients/ollamaClient';

export async function generateExplanation(tafseerText, verse) {
	const schema = {
		explanation: 'string',
		keyTerms: '{term: string, definition: string}[]',
	};
	const query = `
	Rephrase the following tafseer in clear, simple, and concise language for a general audience:
	${tafseerText}
	Guidelines:
	Keep the tone formal but simple (not technical or slang).
	Preserve the original meaning and context.
	Organize the explanation using clear headings (#), subheadings (###), and bullet points (->).
	Highlight and clearly summarize the important points.
	Define key too formal English words and Islamic terms used in the explanation.
	Add a short final summary covering the main ideas.
	Strictly follow this output schema:
	\`\`\`json
	{
	explanation: string,
	keyTerms: { term: string, definition: string }[]
	}
	\`\`\`
	`;

	const response = await ollamaClient
		.pipe(jsonParser)
		.invoke([
			{
				role: 'system',
				content: `You are a teacher who explains Quranic tafseer in simple formal language, not too friendly nor too technical. You always respond in JSON format according to the given schema: ${JSON.stringify(schema)}`,
			},
			{
				role: 'user',
				content: query,
			},
		]);

	return response;
}
