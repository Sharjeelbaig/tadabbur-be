const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
	'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
	constructor(status, detail) {
		super(typeof detail === 'string' ? detail : detail?.message || 'HttpError');
		this.status = status;
		this.detail = detail;
	}
}

const ROUTES = [
	{ method: 'GET', pattern: new URLPattern({ pathname: '/api/chapters' }), handler: listChapters },
	{ method: 'GET', pattern: new URLPattern({ pathname: '/api/chapters/:id' }), handler: getChapter },
	{ method: 'GET', pattern: new URLPattern({ pathname: '/api/languages' }), handler: listLanguages },
	{ method: 'GET', pattern: new URLPattern({ pathname: '/api/recitations' }), handler: listRecitations },
	{ method: 'GET', pattern: new URLPattern({ pathname: '/api/translations' }), handler: listTranslations },
	{ method: 'GET', pattern: new URLPattern({ pathname: '/api/tafsirs' }), handler: listTafsirs },
	{ method: 'POST', pattern: new URLPattern({ pathname: '/api/verse' }), handler: getVerses },
	{ method: 'GET', pattern: new URLPattern({ pathname: '/api/tafsir/:surah/:ayah/:edition' }), handler: getTafsirText },
	{ method: 'POST', pattern: new URLPattern({ pathname: '/api/tafsir/explain' }), handler: explainTafsirProxy },
	{ method: 'POST', pattern: new URLPattern({ pathname: '/api/tafsir/explain-verse' }), handler: explainTafsirModern },
];

let cachedToken = null;
let cachedTokenExpiry = 0;
let pendingTokenPromise = null;

export default {
	async fetch(request, env) {
		try {
			if (request.method === 'OPTIONS') {
				return handleOptions(request);
			}

			const response = await routeRequest(request, env);
			return applyCors(response);
		} catch (error) {
			return handleError(error);
		}
	},
};

async function routeRequest(request, env) {
	const url = new URL(request.url);
	for (const route of ROUTES) {
		if (route.method !== request.method) continue;
		const match = route.pattern.exec(url);
		if (!match) continue;
		return route.handler({ request, env, params: match.pathname.groups, url });
	}
	return jsonResponse(404, { error: { message: 'Not Found' } });
}

function handleOptions(request) {
	const headers = new Headers(CORS_HEADERS);
	const requestMethod = request.headers.get('Access-Control-Request-Method');
	if (requestMethod) {
		headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	}
	const requestHeaders = request.headers.get('Access-Control-Request-Headers');
	if (requestHeaders) {
		headers.set('Access-Control-Allow-Headers', requestHeaders);
	}
	return new Response(null, { status: 204, headers });
}

function applyCors(response) {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(CORS_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function handleError(error) {
	if (error instanceof HttpError) {
		return applyCors(jsonResponse(error.status, { error: normalizeDetail(error.detail) }));
	}
	console.error('Unhandled worker error', error);
	return applyCors(jsonResponse(500, { error: { message: 'Internal Server Error' } }));
}

function jsonResponse(status, data) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function normalizeDetail(detail) {
	if (!detail) return { message: 'Unknown error' };
	if (typeof detail === 'string') return { message: detail };
	if (typeof detail === 'object') return detail;
	return { message: String(detail) };
}

function getQuranConfig(env) {
	const clientId = env.QURAN_FOUNDATION_CLIENT_ID;
	const clientSecret = env.QURAN_FOUNDATION_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new HttpError(500, { message: 'Quran Foundation credentials are not configured' });
	}
	return {
		clientId,
		clientSecret,
		authBase: (env.QURAN_FOUNDATION_AUTH_BASE || 'https://oauth2.quran.foundation').replace(/\/$/, ''),
		apiBase: (env.QURAN_FOUNDATION_API_BASE || 'https://apis.quran.foundation/content/api/v4').replace(/\/$/, ''),
		scope: env.QURAN_FOUNDATION_SCOPE || 'content',
		timeoutMs: Math.max(1000, Math.floor(parseFloat(env.QURAN_FOUNDATION_TIMEOUT || '10') * 1000)),
	};
}

async function getAccessToken(env, forceRefresh = false) {
	const config = getQuranConfig(env);
	const now = Date.now();
	if (!forceRefresh && cachedToken && now < cachedTokenExpiry) {
		return cachedToken;
	}
	if (pendingTokenPromise && !forceRefresh) {
		return pendingTokenPromise;
	}
	const tokenPromise = refreshAccessToken(config).finally(() => {
		if (pendingTokenPromise === tokenPromise) {
			pendingTokenPromise = null;
		}
	});
	if (!forceRefresh) {
		pendingTokenPromise = tokenPromise;
	}
	return tokenPromise;
}

async function refreshAccessToken(config) {
	const body = new URLSearchParams({ grant_type: 'client_credentials', scope: config.scope });
	const authHeader = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
	let response;
	try {
		response = await fetchWithTimeout(`${config.authBase}/oauth2/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: authHeader,
			},
			body: body.toString(),
		}, config.timeoutMs);
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(502, { message: 'Failed to contact Quran Foundation OAuth server', detail: String(error?.message || error) });
	}
	if (!response.ok) {
		const detail = await readUpstream(response);
		throw new HttpError(502, { message: 'Failed to obtain Quran Foundation token', upstream: detail });
	}
	const payload = await parseJsonStrict(response, 'OAuth token response from Quran Foundation is invalid');
	const accessToken = payload.access_token;
	const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : parseInt(payload.expires_in || '3600', 10);
	if (!accessToken) {
		throw new HttpError(502, { message: "OAuth token response from Quran Foundation is missing 'access_token'" });
	}
	cachedToken = accessToken;
	cachedTokenExpiry = Date.now() + Math.max((expiresIn - 60) * 1000, 30000);
	return accessToken;
}

async function makeAuthenticatedRequest(env, path, { params } = {}) {
	const config = getQuranConfig(env);
	const url = new URL(`${config.apiBase}${path}`);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) continue;
			if (Array.isArray(value)) {
				value.forEach((item) => url.searchParams.append(key, String(item)));
			} else {
				url.searchParams.set(key, String(value));
			}
		}
	}
	let token = await getAccessToken(env);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		let response;
		try {
			response = await fetchWithTimeout(url.toString(), {
				headers: {
					'X-Auth-Token': token,
					'X-Client-Id': config.clientId,
				},
			}, config.timeoutMs);
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(502, { message: 'Failed to contact Quran Foundation API', detail: String(error?.message || error) });
		}
		if (response.status === 401 && attempt === 0) {
			token = await getAccessToken(env, true);
			continue;
		}
		if (response.status === 404) {
			const detail = await readUpstream(response);
			throw new HttpError(404, { message: 'Resource not found', url: url.toString(), upstream: detail });
		}
		if (!response.ok) {
			const detail = await readUpstream(response);
			throw new HttpError(502, {
				message: `Failed to fetch from Quran Foundation (status ${response.status})`,
				url: url.toString(),
				upstream: detail,
			});
		}
		return parseJsonStrict(response, 'Invalid JSON payload from Quran Foundation API');
	}
	throw new HttpError(502, { message: 'Unable to authenticate with Quran Foundation API' });
}

async function fetchWithTimeout(url, init, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (error) {
		if (error && error.name === 'AbortError') {
			throw new HttpError(504, { message: `Request to ${url} timed out` });
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

async function readUpstream(response) {
	const text = await response.text();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch (error) {
		return text;
	}
}

async function parseJsonStrict(response, errorMessage) {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new HttpError(502, { message: errorMessage, upstream: text });
	}
}

async function listChapters({ env }) {
	const payload = await makeAuthenticatedRequest(env, '/chapters');
	const chapters = Array.isArray(payload.chapters) ? payload.chapters.map((chapter) => ({
		id: chapter.id,
		revelation_place: chapter.revelation_place,
		revelation_order: chapter.revelation_order,
		name_simple: chapter.name_simple,
		name_complex: chapter.name_complex,
		name_arabic: chapter.name_arabic,
		verses_count: chapter.verses_count,
		pages: chapter.pages,
		translated_name: chapter.translated_name,
	})) : [];
	return jsonResponse(200, { chapters });
}

async function getChapter({ env, params, url }) {
	const id = parseInteger(params.id, 'chapter_id');
	const language = url.searchParams.get('language') || 'en';
	const payload = await makeAuthenticatedRequest(env, `/chapters/${id}`, { params: { language } });
	const chapter = payload.chapter || {};
	return jsonResponse(200, {
		chapter: {
			id: chapter.id,
			revelation_place: chapter.revelation_place,
			revelation_order: chapter.revelation_order,
			name_simple: chapter.name_simple,
			name_complex: chapter.name_complex,
			name_arabic: chapter.name_arabic,
			verses_count: chapter.verses_count,
			pages: chapter.pages,
			translated_name: chapter.translated_name,
		},
	});
}

async function listLanguages({ env }) {
	const payload = await makeAuthenticatedRequest(env, '/resources/languages');
	const languages = Array.isArray(payload.languages) ? payload.languages.map((language) => ({
		id: language.id,
		name: language.name,
		iso_code: language.iso_code,
		native_name: language.native_name,
		direction: language.direction,
	})) : [];
	return jsonResponse(200, { languages });
}

async function listRecitations({ env, url }) {
	const language = url.searchParams.get('language') || 'en';
	const payload = await makeAuthenticatedRequest(env, '/resources/recitations', { params: { language } });
	const recitations = Array.isArray(payload.recitations) ? payload.recitations.map((recitation) => ({
		id: recitation.id,
		reciter_name: recitation.reciter_name,
		style: recitation.style,
		translated_name: recitation.translated_name,
	})) : [];
	return jsonResponse(200, { recitations });
}

async function listTranslations({ env, url }) {
	const language = url.searchParams.get('language') || 'en';
	const payload = await makeAuthenticatedRequest(env, '/resources/translations', { params: { language } });
	const translations = Array.isArray(payload.translations) ? payload.translations.map((translation) => ({
		id: translation.id,
		name: translation.name,
		author_name: translation.author_name,
		slug: translation.slug,
		language_name: translation.language_name,
		translated_name: translation.translated_name,
	})) : [];
	return jsonResponse(200, { translations });
}

async function listTafsirs({ env, url }) {
	const language = url.searchParams.get('language') || 'en';
	const payload = await makeAuthenticatedRequest(env, '/resources/tafsirs', { params: { language } });
	const tafsirs = Array.isArray(payload.tafsirs) ? payload.tafsirs.map((tafsir) => ({
		id: tafsir.id,
		name: tafsir.name,
		author_name: tafsir.author_name,
		slug: tafsir.slug,
		language_name: tafsir.language_name,
		translated_name: tafsir.translated_name,
	})) : [];
	return jsonResponse(200, { tafsirs });
}

async function getVerses({ request, env }) {
	const body = await readJson(request);
	const surahId = parseInteger(body.surah_id, 'surah_id');
	const fromAyah = parseInteger(body.from ?? body.from_, 'from');
	const toAyah = parseInteger(body.to, 'to');
	if (fromAyah > toAyah) {
		throw new HttpError(400, { message: "'from' must be less than or equal to 'to'" });
	}
	const language = (body.language || 'en').trim();
	const fields = Array.isArray(body.fields) ? [...new Set(body.fields.map((field) => String(field).trim()).filter(Boolean))] : undefined;
	const translationId = body.translation_id ? parseInteger(body.translation_id, 'translation_id') : null;
	const recitationId = body.recitation_id ? parseInteger(body.recitation_id, 'recitation_id') : null;
	const tafsirId = body.tafsir_id ? parseInteger(body.tafsir_id, 'tafsir_id') : null;

	const verses = [];
	for (let ayah = fromAyah; ayah <= toAyah; ayah += 1) {
		const verseKey = `${surahId}:${ayah}`;
		const verseData = await fetchVerseByKey(env, verseKey, language, fields);
		if (translationId) {
			verseData.translations = await fetchAyahTranslations(env, verseKey, translationId, language);
		}
		if (recitationId) {
			verseData.recitations = await fetchAyahRecitations(env, verseKey, recitationId);
		}
		if (tafsirId) {
			verseData.tafsirs = await fetchAyahTafsirs(env, verseKey, tafsirId, language);
		}
		verses.push(verseData);
	}

	return jsonResponse(200, {
		surah_id: surahId,
		from: fromAyah,
		to: toAyah,
		verses,
	});
}

async function fetchVerseByKey(env, verseKey, language, fields) {
	const params = { language };
	if (fields && fields.length > 0) {
		params.fields = fields.sort().join(',');
	}
	const payload = await makeAuthenticatedRequest(env, `/verses/by_key/${verseKey}`, { params });
	const verse = payload.verse || {};
	let surahNumber = verse.surah_number;
	if (!surahNumber && verse.verse_key) {
		const [surahPart] = verse.verse_key.split(':');
		surahNumber = parseInt(surahPart, 10);
	}
	return {
		verse_key: verse.verse_key,
		text_uthmani: verse.text_uthmani,
		text_imlaei: verse.text_imlaei,
		text_indopak: verse.text_indopak,
		text_uthmani_simple: verse.text_uthmani_simple,
		juz_number: verse.juz_number,
		hizb_number: verse.hizb_number,
		page_number: verse.page_number,
		verse_number: verse.verse_number,
		surah_number: surahNumber,
	};
}

async function fetchAyahTranslations(env, verseKey, translationId, language) {
	const payload = await makeAuthenticatedRequest(env, `/translations/${translationId}/by_ayah/${verseKey}`, {
		params: { language },
	});
	const translations = Array.isArray(payload.translations) ? payload.translations : [];
	return translations.map((item) => ({
		id: item.id,
		resource_id: item.resource_id,
		text: item.text,
	}));
}

async function fetchAyahRecitations(env, verseKey, recitationId) {
	const payload = await makeAuthenticatedRequest(env, `/recitations/${recitationId}/by_ayah/${verseKey}`);
	const audioFiles = Array.isArray(payload.audio_files) ? payload.audio_files : payload.audio_files ? [payload.audio_files] : [];
	return audioFiles.map((item) => ({
		verse_key: item.verse_key,
		url: item.url,
		recitation_id: recitationId,
	}));
}

async function fetchAyahTafsirs(env, verseKey, tafsirId, language) {
	const payload = await makeAuthenticatedRequest(env, `/tafsirs/${tafsirId}/by_ayah/${verseKey}`, {
		params: { language },
	});
	const tafsir = payload.tafsir || {};
	if (!Object.keys(tafsir).length) return [];
	const translatedName = tafsir.translated_name || {};
	return [{
		resource_id: tafsir.resource_id,
		resource_name: tafsir.resource_name,
		language_name: translatedName.language_name,
		text: tafsir.text,
		slug: tafsir.slug,
	}];
}

async function getTafsirText({ env, params }) {
	const surah = parseInteger(params.surah, 'surah');
	const ayah = parseInteger(params.ayah, 'ayah');
	const edition = parseInteger(params.edition, 'edition');
	const payload = await makeAuthenticatedRequest(env, `/tafsirs/${edition}/by_ayah/${surah}:${ayah}`);
	const tafsir = payload.tafsir || {};
	const text = tafsir.text;
	if (!text) {
		throw new HttpError(404, { message: 'No tafsir found for specified verse and edition' });
	}
	return jsonResponse(200, {
		surah,
		ayah,
		edition,
		text,
	});
}

async function explainTafsirProxy({ request, env }) {
	const body = await readJson(request);
	const targetUrl = body.url || env.INFERENCE_URL;
	if (!targetUrl) {
		throw new HttpError(500, { message: 'Inference URL not configured' });
	}
	let messages;
	if (Array.isArray(body.messages) && body.messages.length > 0) {
		messages = body.messages;
	} else {
		const surah = body.surah;
		const ayah = body.ayah;
		const tafsir = body.tafsir;
		if (!surah || !ayah || !tafsir) {
			throw new HttpError(400, { message: "Either 'messages' or ('surah'+'ayah'+'tafsir') must be provided" });
		}
		const prompt = `Explain the following tafsir: [${truncateText(
			tafsir
		)}] for Surah ${surah}, Ayah ${ayah} from the edition ${body.edition || 'unknown'} in simple terms.`;
		const systemMsg = [
			'You are an expert in Quranic tafsir and Islamic studies.',
			'Your task is to be formal, clear, complete, and concise in explaining Quranic tafsir.',
			'You should avoid using colloquial language, slang or emojis.',
			'You must use formal language but keep it simple and easy to understand.',
			'Try to keep explanations complete enough to not let the user go back to the original tafsir.',
		].join('\n');
		messages = [
			{ role: 'system', content: systemMsg },
			{ role: 'user', content: prompt },
		];
	}
	const inferencePayload = { messages };
	const inferenceResponse = await callInferenceService(targetUrl, inferencePayload, env);
	return jsonResponse(200, inferenceResponse);
}

async function explainTafsirModern({ request, env }) {
	const body = await readJson(request);
	const surah = parseInteger(body.surah, 'surah');
	const ayah = parseInteger(body.ayah, 'ayah');
	const tafsirId = body.tafsir_id ? parseInteger(body.tafsir_id, 'tafsir_id') : 169;
	const tafsirPayload = await makeAuthenticatedRequest(env, `/tafsirs/${tafsirId}/by_ayah/${surah}:${ayah}`);
	const tafsir = tafsirPayload.tafsir || {};
	const tafsirText = tafsir.text;
	if (!tafsirText) {
		throw new HttpError(404, { message: 'Failed to fetch tafsir text for the requested verse' });
	}
	const tafsirInfo = await fetchTafsirInfo(env, tafsirId);
	const tafsirName = tafsirInfo.name || 'Unknown Tafsir';
	const tafsirLanguage = tafsirInfo.language_name || 'english';
	const explainedText = await explainTafsirText(env, {
		tafsirText: truncateText(tafsirText),
		surah,
		ayah,
		tafsirName,
		additionalContext: body.additional_context,
	});
	return jsonResponse(200, {
		surah,
		ayah,
		tafsir_id: tafsirId,
		tafsir_name: tafsirName,
		original_tafsir: tafsirText,
		explained_tafsir: explainedText,
		language: tafsirLanguage,
	});
}

async function fetchTafsirInfo(env, tafsirId) {
	const payload = await makeAuthenticatedRequest(env, '/resources/tafsirs', { params: { language: 'en' } });
	const tafsirs = Array.isArray(payload.tafsirs) ? payload.tafsirs : [];
	const match = tafsirs.find((item) => item.id === tafsirId);
	if (!match) {
		throw new HttpError(404, { message: `Tafsir with ID ${tafsirId} not found` });
	}
	return match;
}

async function explainTafsirText(env, { tafsirText, surah, ayah, tafsirName, additionalContext }) {
	const messages = buildInferenceMessages({ tafsirText, surah, ayah, tafsirName, additionalContext });
	const payload = {
		messages,
		model: 'deepseek-v3.1:671b-cloud',
		additionalSettings: { temperature: 0.3 },
	};
	const response = await callInferenceService(env.INFERENCE_URL, payload, env);
	// Normalize the inference response into a plain string as much as possible.
	if (!response) return '';
	// If upstream already returned a string, use it.
	if (typeof response === 'string') return response;
	// If upstream returned an object, try common fields in order of preference.
	if (typeof response === 'object') {
		if (typeof response.content === 'string') return response.content;
		if (typeof response.text === 'string') return response.text;
		if (typeof response.response === 'string') return response.response;
		// Handle nested result.kwargs.content or kwargs.content (some models use this shape)
		if (response.result && response.result.kwargs && typeof response.result.kwargs.content === 'string') {
			return response.result.kwargs.content;
		}
		if (response.kwargs && typeof response.kwargs.content === 'string') {
			return response.kwargs.content;
		}
		// Fall back to stringifying the object so frontend still receives something useful.
		try {
			return JSON.stringify(response);
		} catch (e) {
			return String(response);
		}
	}
	return String(response);
}

function buildInferenceMessages({ tafsirText, surah, ayah, tafsirName, additionalContext }) {
	const systemPrompt = `You are an expert Islamic scholar specializing in Quranic tafsir (commentary). Your task is to rephrase and explain tafsir texts in modern, easy-to-understand English.

Guidelines:
1. Use formal but clear, modern English that anyone can understand
2. Avoid emojis, slang, and colloquial expressions
3. Be precise and maintain scholarly accuracy
4. When you encounter narrations (hadiths, reports from companions, or historical accounts):
   - Present the narration EXACTLY as given in normal markdown text
	- Follow it with an explanation in a markdown code block (\`\`\`explanation)
   - The explanation should clarify the context, significance, and meaning
5. Format your response in clean markdown
6. Preserve all Arabic terms but provide clear English explanations
7. Make the explanation comprehensive so readers don't need to refer back to the original

Example format for narrations:
It is narrated that the Prophet (peace be upon him) said: "..."

\`\`\`explanation
This narration means... [your clear explanation of the narration's context and significance]
\`\`\`

Now proceed to explain the tafsir while following these guidelines.`;
	let userPrompt = `Please explain the following tafsir in modern, easy-to-understand English:

Surah ${surah}, Verse ${ayah}`;
	if (tafsirName) {
		userPrompt += ` - ${tafsirName}`;
	}
	userPrompt += `

---

${tafsirText}`;
	if (additionalContext) {
		userPrompt += `

Additional Context:
${additionalContext}`;
	}
	return [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userPrompt },
	];
}

async function callInferenceService(url, payload, env) {
	if (!url) {
		throw new HttpError(500, { message: 'Inference URL not configured' });
	}

	// Normalize target URL: if user provided a base host (no path) ensure '/inference' is appended
	let target
	try {
		const u = new URL(url);
		if (!u.pathname || u.pathname === '/') {
			u.pathname = '/inference';
		} else if (!u.pathname.endsWith('/inference')) {
			// if they passed a base like '/': append, otherwise if they already provided a full path
			// that doesn't end with /inference assume they intended base and append
			u.pathname = u.pathname.replace(/\/$/, '') + '/inference';
		}
		target = u.toString();
	} catch (err) {
		// not a valid absolute URL — fall back to using as provided
		target = url;
	}

	const timeoutMs = Math.max(1000, Math.floor(parseFloat(env.INFERENCE_TIMEOUT || '60') * 1000));
	// Build headers; allow optional server-to-server API key for protected worker
	const headers = { 'Content-Type': 'application/json' };
	if (env.INFERENCE_API_KEY) {
		headers['x-api-key'] = env.INFERENCE_API_KEY;
	}

	console.log('callInferenceService ->', { target, payloadSize: JSON.stringify(payload).length, timeoutMs });

	let response;
	try {
		response = await fetchWithTimeout(target, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		}, timeoutMs);
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(502, { message: 'Failed to contact inference service', detail: String(error?.message || error) });
	}

	const upstreamText = await response.text();
	let upstreamBody = null;
	if (upstreamText) {
		try {
			upstreamBody = JSON.parse(upstreamText);
		} catch (e) {
			upstreamBody = upstreamText;
		}
	}

	if (!response.ok) {
		// Include upstream status and parsed body/text to aid debugging
		throw new HttpError(502, {
			message: 'Inference service error',
			upstream_status: response.status,
			upstream: upstreamBody,
		});
	}

	if (!upstreamText) return {};
	try {
		return JSON.parse(upstreamText);
	} catch (error) {
		return { body: upstreamText, status_code: response.status };
	}
}

async function readJson(request) {
	try {
		return await request.json();
	} catch (error) {
		throw new HttpError(400, { message: 'Invalid JSON body' });
	}
}

function parseInteger(value, field) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		throw new HttpError(400, { message: `Field '${field}' must be an integer` });
	}
	return parsed;
}

function truncateText(text, maxLength = 15000) {
	if (typeof text !== 'string' || text.length <= maxLength) {
		return text;
	}
	return text.substring(0, maxLength) + '... [truncated]';
}
