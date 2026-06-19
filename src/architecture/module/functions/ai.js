import tafsirClient from '../clients/tafsirClient.js';
import { getOrGenerateTafseer } from '../clients/dbClient.js';
import {
	mergeChunkResults,
	normalizeAuthorLabel,
	normalizeActiveVerse,
	parseLastValidJsonObject,
	splitTafsirIntoChunks,
	validateExplanationResult,
	validateRelevantChunkResult,
} from './tafsirPrompt.js';

const MAX_RETRIES = 2;
const suggestedPrompt = 'What does this verse say?';

const EXPLANATION_SYSTEM_PROMPT = `
You are a faithful plain-English editor explaining one active Quranic ayah from a source tafsir passage.

The source passage may explain several ayat together. First filter it:
- Include only statements that directly explain the active ayah's words, meaning, reason, lesson, ruling, or necessary connection to its surrounding ayat.
- Exclude statements that apply only to another ayah, even when they appear in the same source passage.
- Keep shared context only when it is necessary to understand the active ayah.
- Use the supplied ayah text and translation to judge relevance. Do not use outside knowledge.
- If a source part contains nothing relevant to the active ayah, mark it irrelevant and return no explanation for that part.

Follow this priority order:
1. VERSE RELEVANCE: Never include material solely about a different ayah.
2. COMPLETE RELEVANT MEANING: Preserve every unique relevant teaching, claim, ruling, reason, condition, exception, comparison, example, disagreement, conclusion, supporting evidence, and what that evidence proves. Preserve who said, believed, or rejected each claim; never transfer a claim to the wrong person or group.
3. EASY ENGLISH: Use short, direct sentences and normal everyday words. Keep necessary Islamic terms, but never use difficult, formal, or academic English when a simple word works.
4. CONCISION: Shorten wording, not relevant meaning. Combine closely related statements and remove repetition only when no unique relevant meaning is lost.

You may condense repeated Arabic when its English meaning is preserved. You may combine long narrator or source lists into a short attribution, but you must retain reliability judgments, scholarly disagreements, exceptions, and evidence details that affect the meaning or strength of the evidence.

Do not add facts, interpretations, verse numbers, background, or conclusions that are absent from the source. Do not soften, strengthen, correct, or judge the author's position.

Use the fewest useful "# Heading" sections. Put concise points below them using "-> ". One point may combine related source statements when every distinct meaning remains.

Never add a Summary section or repeat points at the end. Never create a heading for the author. If attribution is useful, include it naturally inside a relevant point. Never begin every point with the author's name or "According to".

Return one final valid JSON object only:
{"isRelevant":true,"explanation":"# Heading\\n-> concise point","keyTerms":[{"term":"term","definition":"short everyday-English meaning"}]}
When the source part is not relevant, return:
{"isRelevant":false,"explanation":"","keyTerms":[]}
`.trim();

const CORRECTION_REVIEW_SYSTEM_PROMPT = `
You review a complaint about a plain-English Quranic tafsir explanation.
Compare the complaint and explanation only against the supplied source tafsir.
Return one final valid JSON object only:
{"isValidComplaint":true,"correctionReasoning":"brief source-based reason"}
Do not rewrite the explanation in this review step.
`.trim();

const extractResponseText = (response) => {
	if (typeof response === 'string') {
		return response;
	}

	if (typeof response?.content === 'string') {
		return response.content;
	}

	if (Array.isArray(response?.content)) {
		return response.content
			.map((item) => (typeof item === 'string' ? item : item?.text || ''))
			.join('');
	}

	return JSON.stringify(response);
};

const buildVerseChatFallback = (message, error, details) => ({
	explanation: [
		'# Explainer unavailable right now',
		'-> The structured tafsir explanation could not be prepared for this ayah.',
		`-> You can still ask grounded verse chat: "${suggestedPrompt}"`,
		'-> Verse chat answers from the current ayah and selected tafsir.',
	].join('\n'),
	keyTerms: [],
	fallbackMode: 'verse_chat',
	suggestedPrompt,
	error,
	details: details || message,
});

async function invokeJsonWithRetry(messages, predicate, validate, label) {
	let lastError = null;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
		try {
			const retryInstruction =
				attempt === 0
					? []
					: [
							{
								role: 'user',
								content:
									'Your previous response was invalid. Return only one complete final JSON object. Do not include reasoning, an example schema, or extra text.',
							},
						];
			const response = await tafsirClient.invoke([...messages, ...retryInstruction]);
			const parsed = parseLastValidJsonObject(extractResponseText(response), predicate);
			return validate ? validate(parsed) : parsed;
		} catch (error) {
			lastError = error;
			console.error(`${label} attempt ${attempt + 1} failed:`, error.message);
		}
	}

	throw lastError || new Error(`${label} failed.`);
}

function buildChunkPrompt({
	chunk,
	chunkIndex,
	chunkCount,
	authorLabel,
	activeVerse,
	correctionInstruction,
}) {
	const attributionRule =
		chunkIndex === 0
			? `You may naturally mention "${authorLabel}" once in this part if it helps the flow.`
			: 'Do not mention the author in this part.';

	return `
Rewrite source part ${chunkIndex + 1} of ${chunkCount} for a general reader.

ACTIVE AYAH:
- Verse key: ${activeVerse.verseKey || 'not supplied'}
- Arabic text: ${activeVerse.arabicText || 'not supplied'}
- Translation: ${activeVerse.translation || 'not supplied'}

Rules:
- First decide whether this source part contains material relevant to the active ayah.
- Keep every unique meaning relevant to the active ayah.
- Remove explanations, examples, rulings, and conclusions that concern only other ayat.
- A mention of another ayah is allowed only when the source explicitly uses it to explain the active ayah.
- Use the fewest useful headings; do not create a heading for every sentence.
- Use concise "-> " points under headings.
- Use plain everyday English.
- ${attributionRule}
- Never write "(Abridged)" after the author's name.
- Do not add a Summary section.
- The result should be shorter only when wording can be shortened without losing meaning. Never pad it, but never omit a unique detail to meet a length target.
- keyTerms may include only unavoidable Islamic or uncommon terms used in the explanation.
- Do not define Allah, prophets, people, places, books, or verse references.
- Return an empty keyTerms array when no definition is needed.
${correctionInstruction ? `- Apply this verified correction where this source part supports it: ${correctionInstruction}` : ''}

SOURCE TAFSIR PART:
${chunk}
`.trim();
}

export async function generateFreshExplanation(
	tafseerText,
	verse,
	tafseerAuthor,
	{ correctionInstruction = '', verseContext = {} } = {},
) {
	const chunks = splitTafsirIntoChunks(tafseerText);
	if (chunks.length === 0) {
		throw new Error('The source tafsir is empty.');
	}

	const authorLabel = normalizeAuthorLabel(tafseerAuthor);
	const activeVerse = normalizeActiveVerse(verse, verseContext);
	const chunkResults = [];

	for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
		const messages = [
			{ role: 'system', content: EXPLANATION_SYSTEM_PROMPT },
			{
				role: 'user',
				content: buildChunkPrompt({
					chunk: chunks[chunkIndex],
					chunkIndex,
					chunkCount: chunks.length,
					authorLabel,
					activeVerse,
					correctionInstruction,
				}),
			},
		];

		const result = await invokeJsonWithRetry(
			messages,
			(value) =>
				typeof value.isRelevant === 'boolean' && typeof value.explanation === 'string',
			(value) =>
				validateRelevantChunkResult(value, authorLabel, {
					maxAuthorMentions: chunkIndex === 0 ? 2 : 0,
				}),
			`Tafsir chunk ${chunkIndex + 1}/${chunks.length}`,
		);

		chunkResults.push(result);
	}

	const merged = mergeChunkResults(chunkResults);
	if (!merged.explanation) {
		return {
			explanation:
				'# Tafsir for this ayah\n-> The supplied tafsir passage does not clearly contain a separate explanation for this ayah.',
			keyTerms: [],
		};
	}

	return validateExplanationResult(merged, authorLabel);
}

export async function generateExplanation(tafseerText, verse, tafseerAuthor, verseContext = {}) {
	return getOrGenerateTafseer(tafseerText, verse, tafseerAuthor, async () => {
		try {
			return await generateFreshExplanation(tafseerText, verse, tafseerAuthor, {
				verseContext,
			});
		} catch (error) {
			console.error('All tafsir generation attempts failed:', error);
			return buildVerseChatFallback(
				error.message || 'Failed to generate a valid tafsir explanation.',
				'Failed to generate a valid tafsir explanation.',
				error.message,
			);
		}
	});
}

export async function correctTafsir(
	originalExplanation,
	userComplaint,
	sourceText,
	verse,
	tafseerAuthor,
) {
	const authorLabel = normalizeAuthorLabel(tafseerAuthor);
	const verseLabel = verse || 'the selected verse';

	const reviewPrompt = `
VERSE: ${verseLabel}
AUTHOR: ${authorLabel}

SOURCE TAFSIR:
${sourceText}

CURRENT EXPLANATION:
${originalExplanation}

USER COMPLAINT:
${userComplaint}

Decide whether the complaint identifies a real omission, addition, mistranslation, change of meaning, unclear wording, repeated attribution, unnecessary length, or difficult English when compared with the source.
`.trim();

	try {
		const review = await invokeJsonWithRetry(
			[
				{ role: 'system', content: CORRECTION_REVIEW_SYSTEM_PROMPT },
				{ role: 'user', content: reviewPrompt },
			],
			(value) =>
				typeof value.isValidComplaint === 'boolean' &&
				typeof value.correctionReasoning === 'string',
			null,
			'Tafsir correction review',
		);

		if (!review.isValidComplaint) {
			return {
				isValidComplaint: false,
				correctionReasoning: review.correctionReasoning,
				explanation: originalExplanation,
				keyTerms: [],
			};
		}

		const corrected = await generateFreshExplanation(sourceText, verse, tafseerAuthor, {
			correctionInstruction: `${userComplaint}. Review finding: ${review.correctionReasoning}`,
		});

		return {
			isValidComplaint: true,
			correctionReasoning: review.correctionReasoning,
			explanation: corrected.explanation,
			keyTerms: corrected.keyTerms,
		};
	} catch (error) {
		console.error('Failed to process tafsir correction:', error);
		return {
			isValidComplaint: false,
			correctionReasoning: 'The correction request could not be verified against the source.',
			explanation: originalExplanation,
			keyTerms: [],
			error: 'Failed to process the correction request.',
			details: error.message,
		};
	}
}
