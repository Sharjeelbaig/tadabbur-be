import ollamaClient from '../clients/ollamaClient.js';
import QURAN_ASSISTANT_SKILL from '../skills/quranAssistantPrompt.js';
import { TOOL_SPECS, executeTool } from '../tools/verseChatTools.js';

const CACHE = new Map();
const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const ROUTER_CACHE = new Map();
const ROUTER_CACHE_MAX = 300;
const ROUTER_CACHE_TTL_MS = 30 * 60 * 1000;

const REFUSAL_REASONS = new Set([
  'fatwa',
  'out_of_scope',
  'needs_clarification',
  'no_previous_context',
]);

const collapseWhitespace = (value = '') => value.replace(/\s+/g, ' ').trim();
const shorten = (value, maxLength) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;

const extractTextContent = (content) => {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object' && typeof item.text === 'string') {
          return item.text;
        }

        return '';
      })
      .join('');
  }

  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }

  return '';
};

const makeCacheKey = (...parts) =>
  parts.map((part) => collapseWhitespace(String(part || ''))).join('|');

const getCached = (cache, ttlMs, key) => {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.createdAt > ttlMs) {
    cache.delete(key);
    return null;
  }

  return cached;
};

const setCached = (cache, maxSize, key, value) => {
  if (cache.size >= maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, { ...value, createdAt: Date.now() });
};

const buildThreadSummary = (userMessage, answer) =>
  shorten(`Q: ${collapseWhitespace(userMessage)} A: ${collapseWhitespace(answer)}`, 320);

const buildSources = ({ verseContext, tafsirContext, selectedTafsirName, toolResults }) => {
  const evidenceSpans = toolResults.fetch_tafsir_evidence?.spans ?? [];
  const sources = [
    {
      kind: 'verse',
      label: `${verseContext.verseKey} verse`,
      excerpt: shorten(verseContext.translationText, 220),
    },
    {
      kind: 'tafsir',
      label: `${selectedTafsirName || tafsirContext.sourceLabel} tafsir`,
      excerpt: shorten(evidenceSpans.join(' ') || tafsirContext.plainText, 260),
    },
  ];

  const previousContext = toolResults.fetch_previous_verse_context;
  if (previousContext?.available) {
    sources.push({
      kind: 'previous_summary',
      label: `Prev ${previousContext.label} summary`,
      excerpt: shorten(previousContext.summary, 220),
    });
  }

  return sources;
};

const extractJsonCandidate = (text) => {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  return objectMatch ? objectMatch[0] : text.trim();
};

const parseJsonObject = (text) => JSON.parse(extractJsonCandidate(text));

const parseRouterDecision = (text) => {
  const parsed = parseJsonObject(text);
  const validDecision =
    parsed?.decision === 'answer' ||
    parsed?.decision === 'refuse' ||
    parsed?.decision === 'clarify';
  const validIntent =
    parsed?.intent === 'meaning' ||
    parsed?.intent === 'linguistic' ||
    parsed?.intent === 'connection_to_previous' ||
    parsed?.intent === 'reflection' ||
    parsed?.intent === 'fatwa' ||
    parsed?.intent === 'out_of_scope' ||
    parsed?.intent === 'needs_clarification';

  if (!validDecision || !validIntent) {
    throw new Error('Invalid router decision.');
  }

  return {
    decision: parsed.decision,
    intent: parsed.intent,
    reason: typeof parsed.reason === 'string' ? collapseWhitespace(parsed.reason) : '',
    usePreviousContext: Boolean(parsed.usePreviousContext),
  };
};

const parseRefusalVerification = (text) => {
  const parsed = parseJsonObject(text);
  const validIntent =
    parsed?.correctedIntent === 'meaning' ||
    parsed?.correctedIntent === 'linguistic' ||
    parsed?.correctedIntent === 'connection_to_previous' ||
    parsed?.correctedIntent === 'reflection' ||
    parsed?.correctedIntent === 'fatwa' ||
    parsed?.correctedIntent === 'out_of_scope' ||
    parsed?.correctedIntent === 'needs_clarification';

  if (typeof parsed?.confirmed !== 'boolean' || !validIntent) {
    throw new Error('Invalid refusal verification response.');
  }

  return {
    confirmed: parsed.confirmed,
    correctedIntent: parsed.correctedIntent,
    correctedReason: typeof parsed.correctedReason === 'string'
      ? collapseWhitespace(parsed.correctedReason)
      : '',
  };
};

const deriveToolCallsFromDecision = (decision, latestUserMessage) => {
  if (decision.decision === 'refuse') {
    return [
      {
        name: 'refuse_with_reason',
        args: { reason: decision.intent === 'fatwa' ? 'fatwa' : 'out_of_scope' },
        id: 'router-refuse',
      },
    ];
  }

  if (decision.decision === 'clarify' || decision.intent === 'needs_clarification') {
    return [
      {
        name: 'refuse_with_reason',
        args: { reason: 'needs_clarification' },
        id: 'router-clarify',
      },
    ];
  }

  if (decision.intent === 'connection_to_previous') {
    return [
      {
        name: 'fetch_tafsir_evidence',
        args: { query: latestUserMessage },
        id: 'router-tafsir',
      },
      {
        name: 'fetch_previous_verse_context',
        args: {},
        id: 'router-previous',
      },
    ];
  }

  if (decision.intent === 'linguistic') {
    return [
      {
        name: 'fetch_tafsir_evidence',
        args: { query: latestUserMessage },
        id: 'router-tafsir',
      },
      {
        name: 'fetch_verse_linguistics',
        args: {},
        id: 'router-linguistics',
      },
    ];
  }

  return [
    {
      name: 'fetch_tafsir_evidence',
      args: { query: latestUserMessage },
      id: 'router-tafsir',
    },
  ];
};

const normalizeToolCalls = (toolCalls) =>
  Array.isArray(toolCalls)
    ? toolCalls
        .map((call, index) => ({
          name: typeof call?.name === 'string' ? call.name : '',
          args: call?.args && typeof call.args === 'object' ? call.args : {},
          id: typeof call?.id === 'string' ? call.id : `tool-${index}`,
        }))
        .filter((call) => call.name)
    : [];

const verifyToolCalls = (toolCalls, latestUserMessage) => {
  const allowedTools = new Set(TOOL_SPECS.map((tool) => tool.name));
  const validCalls = normalizeToolCalls(toolCalls).filter((call) => allowedTools.has(call.name));

  const refusalCall = validCalls.find(
    (call) =>
      call.name === 'refuse_with_reason' &&
      REFUSAL_REASONS.has(typeof call.args?.reason === 'string' ? call.args.reason : ''),
  );
  if (refusalCall) {
    return [refusalCall];
  }

  const hasTafsir = validCalls.some((call) => call.name === 'fetch_tafsir_evidence');
  const hasPrevious = validCalls.some((call) => call.name === 'fetch_previous_verse_context');
  const hasLinguistics = validCalls.some((call) => call.name === 'fetch_verse_linguistics');

  const verifiedCalls = [...validCalls];
  if (!hasTafsir) {
    verifiedCalls.unshift({
      name: 'fetch_tafsir_evidence',
      args: { query: latestUserMessage },
      id: 'verified-tafsir',
    });
  }

  if (!hasPrevious && !hasLinguistics && verifiedCalls.length === 0) {
    verifiedCalls.push({
      name: 'fetch_tafsir_evidence',
      args: { query: latestUserMessage },
      id: 'verified-fallback',
    });
  }

  return verifiedCalls;
};

const routeWithAI = async ({
  latestUserMessage,
  verseContext,
  tafsirContext,
  threadSummary,
  previousVerseSummary,
}) => {
  const cacheKey = makeCacheKey(
    'route',
    verseContext.verseKey,
    latestUserMessage,
    threadSummary,
    previousVerseSummary,
    tafsirContext.sourceLabel,
  );

  const cached = getCached(ROUTER_CACHE, ROUTER_CACHE_TTL_MS, cacheKey);
  if (cached) {
    return cached;
  }

  const routerMessages = [
    {
      role: 'system',
      content: [
        'You route a Quran verse-chat question for one active ayah.',
        'Choose whether to answer, refuse, or ask for clarification based only on the active ayah, selected tafsir, current thread summary, and optional previous-ayah summary.',
        'Return JSON only.',
        'Schema: {"decision":"answer|refuse|clarify","intent":"meaning|linguistic|connection_to_previous|reflection|fatwa|out_of_scope|needs_clarification","reason":"short string","usePreviousContext":true|false}.',
        'Use "fatwa" only for legal rulings, permissibility, sinfulness, obligations, or personal Islamic judgment.',
        'Use "out_of_scope" only when the question cannot be answered from this ayah and its supplied tafsir.',
        'Use "needs_clarification" only when the user is too vague even with the thread summary.',
        'Short follow-ups like "Explain" may still be answerable if the thread summary shows the current topic.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Question: ${latestUserMessage}`,
        `Active verse: ${verseContext.verseKey}`,
        `Verse translation: ${shorten(verseContext.translationText, 220)}`,
        `Tafsir excerpt: ${shorten(tafsirContext.plainText, 320)}`,
        threadSummary ? `Current thread summary: ${threadSummary}` : '',
        previousVerseSummary ? 'Previous ayah summary exists: yes' : 'Previous ayah summary exists: no',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];

  const response = await ollamaClient.invoke(routerMessages);
  const decision = parseRouterDecision(extractTextContent(response?.content ?? response));
  setCached(ROUTER_CACHE, ROUTER_CACHE_MAX, cacheKey, decision);
  return decision;
};

const verifyRefusalWithAI = async ({
  latestUserMessage,
  verseContext,
  tafsirContext,
  threadSummary,
  previousVerseSummary,
  proposedReason,
}) => {
  const verificationMessages = [
    {
      role: 'system',
      content: [
        'You verify a proposed refusal in a Quran verse-chat.',
        'Return JSON only.',
        'Schema: {"confirmed":true|false,"correctedIntent":"meaning|linguistic|connection_to_previous|reflection|fatwa|out_of_scope|needs_clarification","correctedReason":"short string"}.',
        'If the refusal is too strict and the user can still be answered from the active ayah, choose confirmed=false and set a better correctedIntent.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Question: ${latestUserMessage}`,
        `Proposed refusal reason: ${proposedReason}`,
        `Active verse: ${verseContext.verseKey}`,
        `Verse translation: ${shorten(verseContext.translationText, 220)}`,
        `Tafsir excerpt: ${shorten(tafsirContext.plainText, 320)}`,
        threadSummary ? `Current thread summary: ${threadSummary}` : '',
        previousVerseSummary ? 'Previous ayah summary exists: yes' : 'Previous ayah summary exists: no',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];

  const response = await ollamaClient.invoke(verificationMessages);
  return parseRefusalVerification(extractTextContent(response?.content ?? response));
};

const executeToolCalls = (toolCalls, toolCtx) => {
  const toolResults = {};

  for (const call of toolCalls) {
    toolResults[call.name] = executeTool(call.name, call.args ?? {}, toolCtx);
  }

  return toolResults;
};

const streamFinalAnswer = async (messages, onDelta) => {
  const stream = await ollamaClient.stream(messages);
  let full = '';

  for await (const chunk of stream) {
    const delta = extractTextContent(chunk?.content);
    if (!delta) {
      continue;
    }

    full += delta;
    onDelta(delta);
  }

  return collapseWhitespace(full);
};

export async function streamVerseChatTurn(payload, handlers) {
  const verseContext = payload?.verseContext;
  const rawTafsirContext = payload?.tafsirContext;
  const selectedTafsirName = collapseWhitespace(
    payload?.selectedTafsirName || rawTafsirContext?.sourceLabel || 'Selected',
  );
  const previousVerseSummary = collapseWhitespace(payload?.previousVerseSummary || '');
  const threadSummary = collapseWhitespace(payload?.threadSummary || '');
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];

  const latestUserMessage = collapseWhitespace(
    [...messages]
      .reverse()
      .find((message) => message?.role === 'user' && typeof message?.content === 'string')
      ?.content || '',
  );

  if (!verseContext || !rawTafsirContext || !latestUserMessage) {
    throw new Error('verseContext, tafsirContext, and a user message are required.');
  }

  const tafsirContext = {
    ...rawTafsirContext,
    plainText: collapseWhitespace(rawTafsirContext.plainText || ''),
    sourceLabel: collapseWhitespace(rawTafsirContext.sourceLabel || selectedTafsirName),
  };

  if (!tafsirContext.plainText) {
    throw new Error('tafsirContext.plainText is required.');
  }

  const cacheKey = makeCacheKey(
    verseContext.verseKey,
    payload?.selectedTafsirId,
    selectedTafsirName,
    latestUserMessage,
    threadSummary,
    previousVerseSummary,
  );

  const cached = getCached(CACHE, CACHE_TTL_MS, cacheKey);
  if (cached) {
    handlers.onStatus?.('Using cached answer…');
    handlers.onSources?.(cached.sources);
    handlers.onDelta?.(cached.answer);
    handlers.onDone?.({ summary: cached.summary });
    return;
  }

  const toolCtx = { verseContext, tafsirContext, previousVerseSummary };
  const userContent = [
    `Active verse: ${verseContext.verseKey}`,
    `Tafsir source: ${selectedTafsirName}`,
    threadSummary ? `Thread so far: ${threadSummary}` : '',
    previousVerseSummary ? 'Previous ayah summary exists: yes' : 'Previous ayah summary exists: no',
    `User question: ${latestUserMessage}`,
    'Select the tools you need to answer this question. Follow the skill rules.',
  ]
    .filter(Boolean)
    .join('\n');

  let toolCalls = [];

  handlers.onStatus?.('Agent routing question…');
  try {
    const decision = await routeWithAI({
      latestUserMessage,
      verseContext,
      tafsirContext,
      threadSummary,
      previousVerseSummary,
    });
    toolCalls = deriveToolCallsFromDecision(decision, latestUserMessage);
  } catch (error) {
    console.warn('[verseChatAgent] AI routing failed; defaulting to tafsir evidence.', error?.message);
    toolCalls = deriveToolCallsFromDecision(
      { decision: 'answer', intent: 'meaning', reason: 'Fallback', usePreviousContext: false },
      latestUserMessage,
    );
  }

  toolCalls = verifyToolCalls(toolCalls, latestUserMessage);
  let toolResults = executeToolCalls(toolCalls, toolCtx);

  const refusalCall = toolCalls.find((call) => call.name === 'refuse_with_reason');
  if (refusalCall) {
    let refusalConfirmed = true;
    let correctedIntent = null;

    handlers.onStatus?.('Verifying scope…');
    try {
      const verification = await verifyRefusalWithAI({
        latestUserMessage,
        verseContext,
        tafsirContext,
        threadSummary,
        previousVerseSummary,
        proposedReason: refusalCall.args.reason,
      });
      refusalConfirmed = verification.confirmed;
      correctedIntent = verification.confirmed ? null : verification.correctedIntent;
    } catch (error) {
      console.warn('[verseChatAgent] Refusal verification failed; keeping refusal.', error?.message);
    }

    if (refusalConfirmed) {
      const sources = buildSources({
        verseContext,
        tafsirContext,
        selectedTafsirName,
        toolResults,
      }).slice(0, 2);
      const refusal = toolResults.refuse_with_reason;
      const answer = refusal?.message || 'This question is outside my scope for the active ayah.';
      const summary = buildThreadSummary(latestUserMessage, answer);
      handlers.onSources?.(sources);
      handlers.onDelta?.(answer);
      setCached(CACHE, CACHE_MAX, cacheKey, { answer, sources, summary });
      handlers.onDone?.({ summary });
      return;
    }

    toolCalls = verifyToolCalls(
      deriveToolCallsFromDecision(
        {
          decision: correctedIntent === 'needs_clarification' ? 'clarify' : 'answer',
          intent: correctedIntent || 'meaning',
          reason: 'Refusal overridden by verifier.',
          usePreviousContext: correctedIntent === 'connection_to_previous',
        },
        latestUserMessage,
      ),
      latestUserMessage,
    );
    toolResults = executeToolCalls(toolCalls, toolCtx);
  }

  const sources = buildSources({
    verseContext,
    tafsirContext,
    selectedTafsirName,
    toolResults,
  });
  handlers.onSources?.(sources);

  handlers.onStatus?.('Composing answer…');
  const evidenceSummary = Object.entries(toolResults)
    .map(([toolName, result]) => `[${toolName}]\n${JSON.stringify(result, null, 2)}`)
    .join('\n\n');

  const finalMessages = [
    {
      role: 'system',
      content: [
        QURAN_ASSISTANT_SKILL,
        'You have already received the tool results below.',
        'Do not call more tools. Do not narrate your retrieval process.',
        'Stay strictly within the supplied evidence.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        userContent,
        '',
        '--- Tool Results ---',
        evidenceSummary,
        '',
        'Write the final answer now.',
      ].join('\n'),
    },
  ];

  const answer = await streamFinalAnswer(finalMessages, (delta) => {
    handlers.onDelta?.(delta);
  });
  const summary = buildThreadSummary(latestUserMessage, answer);
  setCached(CACHE, CACHE_MAX, cacheKey, { answer, sources, summary });
  handlers.onDone?.({ summary });
}
