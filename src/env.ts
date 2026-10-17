import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	TODOIST_API_TOKEN: {
		description:
			'Personal Todoist API token. Optional: if unset, the user can enter one in the app.',
		schema: (value) => (value && value.trim() ? value.trim() : undefined)
	}
});
