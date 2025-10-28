import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Tadabbur API worker', () => {
	it('returns JSON 404 for unknown routes', async () => {
		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		await expect(response.json()).resolves.toMatchObject({ error: { message: 'Not Found' } });
	});

	it('handles CORS preflight requests', async () => {
		const request = new Request('http://example.com/api/verse', {
			method: 'OPTIONS',
			headers: {
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'Content-Type',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
		expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
	});
});
