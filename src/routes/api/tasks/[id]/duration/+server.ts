import { error } from '@sveltejs/kit';
import { clientFor, proxy, readJson } from '#lib/server/todoist-api.js';
import { saveTaskDuration } from '#lib/todoist.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const api = clientFor(event);
	const { minutes } = await readJson(event);
	if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1) {
		error(400, 'minutes must be a positive integer');
	}
	return proxy(async () => {
		await saveTaskDuration(api, event.params.id, minutes);
		return { ok: true };
	});
};
