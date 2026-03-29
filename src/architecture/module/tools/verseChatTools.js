/**
 * verseChatTools.js
 *
 * Pure, deterministic tool implementations for the Quran verse chat agent.
 * No LLM calls here — these are the agent's hands, not its brain.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

const collapseWhitespace = (value = '') => value.replace(/\s+/g, ' ').trim();

const shorten = (value, maxLength) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;

const tokenize = (value) => {
  const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'ayah', 'be', 'by', 'for', 'from',
    'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'quran',
    'so', 'that', 'the', 'this', 'to', 'verse', 'what', 'why', 'with', 'you', 'your',
  ]);

  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
};

const splitIntoSpans = (value) =>
  value
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((s) => collapseWhitespace(s))
    .filter(Boolean);

const overlapScore = (queryTokens, candidateText) => {
  const candidateTokens = tokenize(candidateText);
  const querySet = new Set(queryTokens);
  return candidateTokens.filter((t) => querySet.has(t)).length;
};

// ─── Tool: fetch_tafsir_evidence ─────────────────────────────────────────────

/**
 * Retrieves the top tafsir spans most relevant to the user query.
 *
 * @param {string} query - The user's question
 * @param {object} tafsirContext - { plainText, sourceLabel }
 * @param {object} verseContext - { translationText, verseKey }
 * @returns {{ spans: string[], verseOverlapScore: number, tafsirTopScore: number }}
 */
export function fetchTafsirEvidence({ query, tafsirContext, verseContext }) {
  const queryTokens = tokenize(query);
  const spans = splitIntoSpans(tafsirContext.plainText);

  const scored = spans
    .map((span) => ({ span, score: overlapScore(queryTokens, span) }))
    .sort((a, b) => b.score - a.score);

  const relevantSpans = scored
    .filter((item) => item.score > 0)
    .slice(0, 3)
    .map((item) => shorten(item.span, 280));

  const verseOverlapScore = overlapScore(queryTokens, verseContext.translationText);
  const tafsirTopScore = scored[0]?.score ?? 0;

  return {
    spans: relevantSpans,
    verseOverlapScore,
    tafsirTopScore,
    sourceLabel: tafsirContext.sourceLabel,
  };
}

// ─── Tool: fetch_verse_linguistics ───────────────────────────────────────────

/**
 * Returns the Arabic text, translation, and verse key for linguistic analysis.
 *
 * @param {object} verseContext - { arabicText, translationText, verseKey }
 * @returns {{ arabicText: string, translationText: string, verseKey: string }}
 */
export function fetchVerseLinguistics({ verseContext }) {
  return {
    arabicText: shorten(verseContext.arabicText || '', 300),
    translationText: shorten(verseContext.translationText || '', 280),
    verseKey: verseContext.verseKey,
  };
}

// ─── Tool: fetch_previous_verse_context ──────────────────────────────────────

/**
 * Returns the previous ayah's thread summary if available.
 *
 * @param {string} previousVerseSummary
 * @param {object} verseContext - { surahId, ayahNumber, verseKey }
 * @returns {{ available: boolean, summary?: string, label?: string }}
 */
export function fetchPreviousVerseContext({ previousVerseSummary, verseContext }) {
  if (!previousVerseSummary) {
    return { available: false };
  }

  const prevLabel =
    verseContext.ayahNumber > 1
      ? `${verseContext.surahId}:${verseContext.ayahNumber - 1}`
      : 'previous ayah';

  return {
    available: true,
    label: prevLabel,
    summary: shorten(previousVerseSummary, 280),
  };
}

// ─── Tool: refuse_with_reason ─────────────────────────────────────────────────

const REFUSAL_MESSAGES = {
  fatwa: () =>
    'I can explain this ayah and its tafsir, but fatwas and personal religious rulings are outside my scope. Please ask a qualified mufti or trusted scholar. If you like, ask what this ayah itself emphasises.',

  out_of_scope: (verseKey) =>
    `I can only answer from the active ayah (${verseKey}) and its selected tafsir. Try asking about its meaning, a specific word, a lesson it highlights, or how it connects to the previous ayah.`,

  needs_clarification: (verseKey) =>
    `Could you narrow the question? For example: what ${verseKey} means, what a key word refers to, or how it connects to the previous ayah.`,

  no_previous_context: () =>
    `I don't have a prior-ayah summary yet. Chat on the previous ayah first to build context, or ask a question about the current ayah directly.`,
};

/**
 * Returns a canned refusal message for out-of-scope or policy-violating queries.
 *
 * @param {'fatwa'|'out_of_scope'|'needs_clarification'|'no_previous_context'} reason
 * @param {object} verseContext
 * @returns {{ refused: true, message: string, reason: string }}
 */
export function refuseWithReason({ reason, verseContext }) {
  const builder = REFUSAL_MESSAGES[reason];
  const message = builder ? builder(verseContext?.verseKey) : 'This question is outside my scope.';
  return { refused: true, message, reason };
}

// ─── Tool registry (used by the agent loop) ──────────────────────────────────

export const TOOL_SPECS = [
  {
    name: 'fetch_tafsir_evidence',
    description:
      'Retrieve the most relevant tafsir spans for the user query. Returns scored evidence spans and overlap metrics. Call this for meaning, reflection, or lesson questions.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The user question to match against the tafsir.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_verse_linguistics',
    description:
      'Get the Arabic text, transliteration cues, and translation of the active verse. Call this when the question involves Arabic words, roots, grammar, or phrasing.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'fetch_previous_verse_context',
    description:
      'Get the thread summary of the previous ayah. Call this only when the user explicitly asks about continuity, connection, or transition from the previous ayah.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'refuse_with_reason',
    description:
      'Return a scoped refusal when the query is a fatwa request, out of scope, too vague, or requires previous context that is not available. Call this BEFORE any other tool when a refusal applies.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['fatwa', 'out_of_scope', 'needs_clarification', 'no_previous_context'],
          description: 'Why the query cannot be answered.',
        },
      },
      required: ['reason'],
    },
  },
];

// ─── Tool executor (maps model tool-call → implementation) ───────────────────

/**
 * Executes a tool call from the model.
 *
 * @param {string} toolName
 * @param {object} toolInput  - parsed JSON from the model's tool_use block
 * @param {object} ctx        - runtime context (verseContext, tafsirContext, etc.)
 * @returns {object}          - tool result (serialisable)
 */
export function executeTool(toolName, toolInput, ctx) {
  switch (toolName) {
    case 'fetch_tafsir_evidence':
      return fetchTafsirEvidence({
        query: toolInput.query,
        tafsirContext: ctx.tafsirContext,
        verseContext: ctx.verseContext,
      });

    case 'fetch_verse_linguistics':
      return fetchVerseLinguistics({ verseContext: ctx.verseContext });

    case 'fetch_previous_verse_context':
      return fetchPreviousVerseContext({
        previousVerseSummary: ctx.previousVerseSummary,
        verseContext: ctx.verseContext,
      });

    case 'refuse_with_reason':
      return refuseWithReason({
        reason: toolInput.reason,
        verseContext: ctx.verseContext,
      });

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
