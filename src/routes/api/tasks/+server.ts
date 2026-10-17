import { clientFor, proxy } from '#lib/server/todoist-api.js';
import { fetchActiveTasks } from '#lib/todoist.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const api = clientFor(event);
	return proxy(async () => ({ tasks: await fetchActiveTasks(api) }));
};
