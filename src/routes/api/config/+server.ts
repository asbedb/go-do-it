import { json } from '@sveltejs/kit';
import { hasServerToken } from '#lib/server/todoist-api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ serverToken: hasServerToken() });
