import { describe, expect, it } from 'vitest';
import {
	MAX_KEY_TERMS,
	countAuthorMentions,
	mergeChunkResults,
	normalizeActiveVerse,
	normalizeAuthorLabel,
	parseLastValidJsonObject,
	splitTafsirIntoChunks,
	validateExplanationResult,
	validateRelevantChunkResult,
} from '../src/architecture/module/functions/tafsirPrompt.js';

const collapseWhitespace = (value) => value.replace(/\s+/g, ' ').trim();

describe('tafsir prompt utilities', () => {
	it('splits at sentence boundaries without losing or duplicating normalized source text', () => {
		const source = Array.from(
			{ length: 120 },
			(_, index) => `Sentence ${index + 1} keeps a distinct ruling and its reason.`,
		).join(' ');

		const chunks = splitTafsirIntoChunks(source, 500);

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
		expect(chunks.join(' ')).toBe(collapseWhitespace(source));
	});

	it('handles a 50,000-character source in ordered bounded chunks', () => {
		const source = Array.from(
			{ length: 1100 },
			(_, index) => `Meaning ${index + 1} must remain in its original order.`,
		).join(' ');

		const chunks = splitTafsirIntoChunks(source);

		expect(source.length).toBeGreaterThan(50_000);
		expect(chunks.length).toBeGreaterThan(8);
		expect(chunks.every((chunk) => chunk.length <= 6000)).toBe(true);
		expect(chunks.join(' ')).toBe(collapseWhitespace(source));
	});

	it('selects the last valid explanation object after reasoning and malformed examples', () => {
		const response = [
			'Thinking about the requested schema.',
			'{"explanation":"example","keyTerms":[{"term":"broken"...}]}',
			'More reasoning that must be ignored.',
			'{"explanation":"# Topic\\n-> Final point.","keyTerms":[]}',
		].join('\n');

		const parsed = parseLastValidJsonObject(
			response,
			(value) => typeof value.explanation === 'string',
		);

		expect(parsed.explanation).toBe('# Topic\n-> Final point.');
	});

	it('merges chunks in order, removes adjacent duplicate headings, and limits key terms', () => {
		const results = [
			{
				isRelevant: true,
				explanation: '# Shared Topic\n-> First point.',
				keyTerms: [
					{ term: 'Shirk', definition: 'Associating partners with Allah.' },
					{ term: 'Tafsir', definition: 'Explanation of the Quran.' },
				],
			},
			{
				isRelevant: false,
				explanation: '# Another Ayah\n-> This must be excluded.',
				keyTerms: [{ term: 'Excluded', definition: 'Must not be returned.' }],
			},
			{
				isRelevant: true,
				explanation: '# Shared Topic\n-> Second point.\n# Next Topic\n-> Third point.',
				keyTerms: [
					{ term: 'shirk', definition: 'Duplicate definition.' },
					...Array.from({ length: 10 }, (_, index) => ({
						term: `Term ${index + 1}`,
						definition: `Meaning ${index + 1}`,
					})),
				],
			},
		];

		const merged = mergeChunkResults(results);

		expect(merged.explanation).toBe(
			'# Shared Topic\n-> First point.\n-> Second point.\n\n# Next Topic\n-> Third point.',
		);
		expect(merged.keyTerms).toHaveLength(MAX_KEY_TERMS);
		expect(merged.keyTerms.filter((item) => item.term.toLowerCase() === 'shirk')).toHaveLength(1);
		expect(merged.explanation).not.toContain('Another Ayah');
		expect(merged.keyTerms.some((item) => item.term === 'Excluded')).toBe(false);
	});

	it('normalizes active ayah grounding and strips markup from its translation', () => {
		expect(
			normalizeActiveVerse('2:5', {
				arabicText: '  هُدًى   ',
				translation: '<span>Those are upon guidance</span>',
			}),
		).toEqual({
			verseKey: '2:5',
			arabicText: 'هُدًى',
			translation: 'Those are upon guidance',
		});
	});

	it('drops output from a source chunk marked irrelevant to the active ayah', () => {
		expect(
			validateRelevantChunkResult(
				{
					isRelevant: false,
					explanation: '# Other Verse\n-> Unrelated commentary.',
					keyTerms: [{ term: 'Other', definition: 'Unrelated.' }],
				},
				'Ibn Kathir',
			),
		).toMatchObject({
			isRelevant: false,
			explanation: '',
			keyTerms: [],
		});
	});

	it('normalizes abridged author labels and rejects summaries or excessive attribution', () => {
		expect(normalizeAuthorLabel('Ibn Kathir (Abridged)')).toBe('Ibn Kathir');
		expect(countAuthorMentions('Ibn Kathir explains this. Ibn Kathir adds a detail.', 'Ibn Kathir')).toBe(2);

		expect(() =>
			validateExplanationResult(
				{ explanation: '# Topic\n-> Point.\n# Summary\n-> Repeated point.' },
				'Ibn Kathir',
			),
		).toThrow(/summary/i);

		expect(() =>
			validateExplanationResult(
				{
					explanation:
						'# Topic\n-> Ibn Kathir explains one point.\n-> Ibn Kathir explains another.\n-> Ibn Kathir repeats again.',
				},
				'Ibn Kathir',
			),
		).toThrow(/author attribution/i);

		expect(() =>
			validateExplanationResult(
				{
					explanation:
						'# Main Point\n-> The verse rejects divinity.\n# Ibn Kathir’s View\n-> Ibn Kathir says the verse rejects divinity.',
				},
				'Ibn Kathir',
			),
		).toThrow(/author-only heading/i);

		expect(() =>
			validateExplanationResult(
				{
					explanation: '# Topic\n-> Ibn Kathir explains the point.',
				},
				'Ibn Kathir',
				{ maxAuthorMentions: 0 },
			),
		).toThrow(/author attribution/i);

		expect(() =>
			validateExplanationResult(
				{
					explanation: '# Topic\nThis line is not an arrow point.',
				},
				'Ibn Kathir',
			),
		).toThrow(/heading and arrow-point format/i);
	});
});
