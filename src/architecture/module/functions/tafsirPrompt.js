export const TAFSIR_PROMPT_VERSION = 'v3-verse-filtered';
export const TAFSIR_CHUNK_SIZE = 6000;
export const MAX_AUTHOR_MENTIONS = 2;
export const MAX_KEY_TERMS = 8;

const collapseWhitespace = (value = '') => String(value).replace(/\s+/g, ' ').trim();
const collapseMarkup = (value = '') =>
	collapseWhitespace(String(value).replace(/<[^>]+>/g, ' '));
const normalizeHeading = (value = '') =>
	collapseWhitespace(value.replace(/^#{1,6}\s*/, '')).toLocaleLowerCase();

export function normalizeAuthorLabel(author = '') {
	const normalized = collapseWhitespace(author).replace(/\s*\(\s*abridged\s*\)\s*/gi, '').trim();
	return normalized || 'the author';
}

export function normalizeActiveVerse(verse = '', verseContext = {}) {
	const suppliedContext =
		verseContext && typeof verseContext === 'object' && !Array.isArray(verseContext)
			? verseContext
			: {};
	const suppliedVerse =
		verse && typeof verse === 'object' && !Array.isArray(verse) ? verse : {};

	return {
		verseKey: collapseWhitespace(
			suppliedContext.verseKey ??
				suppliedContext.key ??
				suppliedVerse.verseKey ??
				suppliedVerse.key ??
				(typeof verse === 'string' ? verse : ''),
		),
		arabicText: collapseMarkup(
			suppliedContext.arabicText ??
				suppliedContext.verseText ??
				suppliedVerse.arabicText ??
				suppliedVerse.verseText ??
				suppliedVerse.text ??
				'',
		),
		translation: collapseMarkup(
			suppliedContext.translation ??
				suppliedContext.translationText ??
				suppliedVerse.translation ??
				suppliedVerse.translationText ??
				'',
		),
	};
}

export function splitTafsirIntoChunks(sourceText, maxChars = TAFSIR_CHUNK_SIZE) {
	const normalized = collapseWhitespace(sourceText);
	if (!normalized) {
		return [];
	}

	if (normalized.length <= maxChars) {
		return [normalized];
	}

	const chunks = [];
	let remaining = normalized;
	const minimumSentenceSplit = Math.floor(maxChars * 0.55);

	while (remaining.length > maxChars) {
		const window = remaining.slice(0, maxChars + 1);
		let splitAt = -1;
		const sentenceBoundary = /[.!?؟۔](?=\s)/g;
		let match;

		while ((match = sentenceBoundary.exec(window)) !== null) {
			const candidate = match.index + match[0].length;
			if (candidate >= minimumSentenceSplit) {
				splitAt = candidate;
			}
		}

		if (splitAt === -1) {
			splitAt = window.lastIndexOf(' ');
		}

		if (splitAt <= 0) {
			splitAt = maxChars;
		}

		chunks.push(remaining.slice(0, splitAt).trim());
		remaining = remaining.slice(splitAt).trim();
	}

	if (remaining) {
		chunks.push(remaining);
	}

	return chunks;
}

function collectJsonObjects(text) {
	const objects = [];
	const input = String(text ?? '');

	for (let start = 0; start < input.length; start += 1) {
		if (input[start] !== '{') {
			continue;
		}

		let depth = 0;
		let inString = false;
		let escaped = false;

		for (let index = start; index < input.length; index += 1) {
			const character = input[index];

			if (inString) {
				if (escaped) {
					escaped = false;
				} else if (character === '\\') {
					escaped = true;
				} else if (character === '"') {
					inString = false;
				}
				continue;
			}

			if (character === '"') {
				inString = true;
			} else if (character === '{') {
				depth += 1;
			} else if (character === '}') {
				depth -= 1;
				if (depth === 0) {
					try {
						objects.push(JSON.parse(input.slice(start, index + 1)));
					} catch {
						// Ignore malformed or example objects and keep scanning.
					}
					break;
				}
			}
		}
	}

	return objects;
}

export function parseLastValidJsonObject(text, predicate = () => true) {
	const matches = collectJsonObjects(text).filter(
		(value) => value && typeof value === 'object' && !Array.isArray(value) && predicate(value),
	);

	if (matches.length === 0) {
		throw new Error('The model did not return a valid JSON object.');
	}

	return matches[matches.length - 1];
}

export function countAuthorMentions(explanation, authorLabel) {
	const normalizedAuthor = normalizeAuthorLabel(authorLabel);
	if (!normalizedAuthor || normalizedAuthor === 'the author') {
		return 0;
	}

	const escapedAuthor = normalizedAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return (String(explanation).match(new RegExp(escapedAuthor, 'gi')) || []).length;
}

export function validateExplanationResult(
	result,
	authorLabel,
	{ maxAuthorMentions = MAX_AUTHOR_MENTIONS } = {},
) {
	if (!result || typeof result.explanation !== 'string' || !result.explanation.trim()) {
		throw new Error('The model response has no explanation.');
	}

	const lines = result.explanation.split(/\r?\n/).filter((line) => line.trim());
	if (
		!lines.some((line) => /^#{1,6}\s+/.test(line.trim())) ||
		!lines.some((line) => /^->\s+/.test(line.trim())) ||
		lines.some((line) => !/^#{1,6}\s+/.test(line.trim()) && !/^->\s+/.test(line.trim()))
	) {
		throw new Error('The model did not use the required heading and arrow-point format.');
	}

	if (/^#{1,6}\s*summary\b/im.test(result.explanation)) {
		throw new Error('The model added a forbidden summary section.');
	}

	if (/\(\s*abridged\s*\)/i.test(result.explanation)) {
		throw new Error('The model included the unwanted abridged author label.');
	}

	if (countAuthorMentions(result.explanation, authorLabel) > maxAuthorMentions) {
		throw new Error('The model repeated the author attribution too often.');
	}

	const normalizedAuthor = normalizeAuthorLabel(authorLabel);
	if (normalizedAuthor !== 'the author') {
		const escapedAuthor = normalizedAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (new RegExp(`^#{1,6}[^\\n]*${escapedAuthor}`, 'im').test(result.explanation)) {
			throw new Error('The model created a redundant author-only heading.');
		}
	}

	return result;
}

export function validateRelevantChunkResult(
	result,
	authorLabel,
	{ maxAuthorMentions = MAX_AUTHOR_MENTIONS } = {},
) {
	if (!result || typeof result.isRelevant !== 'boolean') {
		throw new Error('The model did not state whether this source part is relevant to the active ayah.');
	}

	if (!result.isRelevant) {
		return {
			...result,
			explanation: '',
			keyTerms: [],
		};
	}

	return {
		...validateExplanationResult(result, authorLabel, { maxAuthorMentions }),
		isRelevant: true,
	};
}

function normalizeKeyTerm(item) {
	if (!item || typeof item !== 'object') {
		return null;
	}

	const term = collapseWhitespace(item.term);
	const definition = collapseWhitespace(item.definition ?? item.meaning);
	if (!term || !definition) {
		return null;
	}

	return { term, definition };
}

export function mergeChunkResults(results) {
	const outputLines = [];
	const seenTerms = new Set();
	const keyTerms = [];
	let activeHeading = '';

	for (const result of results) {
		if (result?.isRelevant === false) {
			continue;
		}

		const lines = String(result?.explanation ?? '').split(/\r?\n/);

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) {
				continue;
			}

			if (/^#{1,6}\s+/.test(line)) {
				const heading = normalizeHeading(line);
				if (heading && heading === activeHeading) {
					continue;
				}
				activeHeading = heading;
				if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== '') {
					outputLines.push('');
				}
				outputLines.push(line.replace(/^#{1,6}\s+/, '# '));
				continue;
			}

			outputLines.push(line);
		}

		for (const item of Array.isArray(result?.keyTerms) ? result.keyTerms : []) {
			if (keyTerms.length >= MAX_KEY_TERMS) {
				break;
			}

			const normalized = normalizeKeyTerm(item);
			if (!normalized) {
				continue;
			}

			const key = normalized.term.toLocaleLowerCase();
			if (seenTerms.has(key)) {
				continue;
			}

			seenTerms.add(key);
			keyTerms.push(normalized);
		}
	}

	return {
		explanation: outputLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
		keyTerms,
	};
}
