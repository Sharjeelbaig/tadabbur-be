import { ChatOllama } from '@langchain/ollama';
import { env } from 'process';

export const TAFSIR_MODEL = 'gpt-oss:120b-cloud';

const tafsirClient = new ChatOllama({
	baseUrl: 'https://ollama.com',
	model: TAFSIR_MODEL,
	headers: {
		Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
	},
	think: false,
	temperature: 0.2,
	format: 'json',
});

export default tafsirClient;
