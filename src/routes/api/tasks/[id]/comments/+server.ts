import { error } from '@sveltejs/kit';
import { clientFor, proxy, readJson } from '#lib/server/todoist-api.js';
import { postSessionComment } from '#lib/todoist.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const api = clientFor(event);
	const { content } = await readJson(event);
	if (typeof content !== 'string' || !content.trim()) error(400, 'content is required');
	return proxy(async () => {
		await postSessionComment(api, event.params.id, content);
		return { ok: true };
	});
};
