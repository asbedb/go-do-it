import { TodoistApi } from '@doist/todoist-sdk';
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { TODOIST_API_TOKEN } from '$app/env/private';
import { todoistErrorMessage, todoistErrorStatus, type TodoistClient } from '#lib/todoist.js';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, TOKEN_HEADER } from '#lib/api-headers.js';

export function hasServerToken(): boolean {
	return Boolean(TODOIST_API_TOKEN);
}

/**
 * Builds an SDK client for this request. The server's env token wins; otherwise
 * the token the user entered in the app is used. Tokens are never logged.
 */
export function clientFor(event: RequestEvent): TodoistClient {
	// A custom header forces a CORS preflight, so other sites can't drive this
	// proxy with the server's token.
	if (event.request.headers.get(CLIENT_HEADER) !== CLIENT_HEADER_VALUE) {
		error(403, 'Missing client header');
	}
	const token = TODOIST_API_TOKEN || event.request.headers.get(TOKEN_HEADER)?.trim();
	if (!token) error(401, 'No Todoist API token configured');
	return new TodoistApi(token);
}

/** Runs a Todoist call and turns SDK failures into a JSON error with the API's message. */
export async function proxy<T>(run: () => Promise<T>): Promise<Response> {
	try {
		return json(await run());
	} catch (e) {
		return json({ error: todoistErrorMessage(e) }, { status: todoistErrorStatus(e) });
	}
}

export async function readJson(event: RequestEvent): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await event.request.json();
		if (typeof body === 'object' && body !== null) return body as Record<string, unknown>;
	} catch {
		// fall through
	}
	error(400, 'Expected a JSON object body');
}
