// App-wide singletons used by the components.
import * as api from './api.js';
import { getBrowserStorage } from './persistence.js';
import { Timers } from './timers.svelte.js';

const TOKEN_KEY = 'todoist-timer:token';

export const timers = new Timers({
	storage: getBrowserStorage(),
	api: { postComment: api.postComment, saveDuration: api.saveDuration }
});

/** Token the user typed in, used only when the server has no TODOIST_API_TOKEN. */
export function loadUserToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function saveUserToken(token: string | null): void {
	api.setUserToken(token);
	try {
		if (token) localStorage.setItem(TOKEN_KEY, token);
		else localStorage.removeItem(TOKEN_KEY);
	} catch {
		// Storage blocked: the token still works until the tab closes.
	}
}
