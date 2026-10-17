// Browser-side calls to this app's own /api routes, which hold the Todoist
// token server-side (or forward the one the user typed in).
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, TOKEN_HEADER } from './api-headers.js';
import type { TaskSummary } from './todoist.js';

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

let userToken: string | null = null;

export function setUserToken(token: string | null): void {
	userToken = token?.trim() || null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set(CLIENT_HEADER, CLIENT_HEADER_VALUE);
	if (userToken) headers.set(TOKEN_HEADER, userToken);
	if (init.body) headers.set('content-type', 'application/json');

	let res: Response;
	try {
		res = await fetch(path, { ...init, headers });
	} catch {
		throw new ApiError('Could not reach the app server. Is it running?', 0);
	}

	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		// non-JSON error page
	}
	if (!res.ok) {
		const b = body as { error?: unknown; message?: unknown } | null;
		const message =
			(typeof b?.error === 'string' && b.error) ||
			(typeof b?.message === 'string' && b.message) ||
			`Request failed (HTTP ${res.status})`;
		throw new ApiError(message, res.status);
	}
	return body as T;
}

export async function getConfig(): Promise<{ serverToken: boolean }> {
	return request('/api/config');
}

export async function getTasks(): Promise<TaskSummary[]> {
	const { tasks } = await request<{ tasks: TaskSummary[] }>('/api/tasks');
	return tasks;
}

export async function postComment(taskId: string, content: string): Promise<void> {
	await request(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
		method: 'POST',
		body: JSON.stringify({ content })
	});
}

export async function saveDuration(taskId: string, minutes: number): Promise<void> {
	await request(`/api/tasks/${encodeURIComponent(taskId)}/duration`, {
		method: 'POST',
		body: JSON.stringify({ minutes })
	});
}
