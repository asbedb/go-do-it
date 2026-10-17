import {
	makeBaseline,
	type Baseline,
	type Segment,
	type Session,
	type SessionMap,
	type TaskDuration,
	type TimerStatus
} from './timer.js';

export const STORAGE_KEY = 'todoist-timer:v1';
export const BACKUP_KEY = `${STORAGE_KEY}:unreadable-backup`;

export type LoadResult =
	| { ok: true; sessions: SessionMap }
	| { ok: false; sessions: SessionMap; reason: 'unavailable' | 'corrupt'; message: string };

const STATUSES: readonly TimerStatus[] = ['idle', 'running', 'paused', 'done'];

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

function parseSegment(raw: unknown): Segment | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const { start, end } = raw as Record<string, unknown>;
	if (!isFiniteNumber(start) || !isFiniteNumber(end) || end < start) return null;
	return { start, end };
}

function parseSession(raw: unknown): Session | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const r = raw as Record<string, unknown>;
	if (!STATUSES.includes(r.status as TimerStatus)) return null;
	if (!isFiniteNumber(r.accumulatedMs) || r.accumulatedMs < 0) return null;
	if (r.runningSince !== null && !isFiniteNumber(r.runningSince)) return null;
	if (!Array.isArray(r.segments)) return null;
	if (typeof r.commentPosted !== 'boolean' || typeof r.durationSaved !== 'boolean') return null;

	const segments: Segment[] = [];
	for (const s of r.segments) {
		const seg = parseSegment(s);
		if (!seg) return null;
		segments.push(seg);
	}

	const status = r.status as TimerStatus;
	const runningSince = r.runningSince as number | null;
	// A running session must have a start; nothing else may have one.
	if ((status === 'running') !== (runningSince !== null)) return null;

	return {
		status,
		accumulatedMs: r.accumulatedMs,
		runningSince,
		segments,
		commentPosted: r.commentPosted,
		durationSaved: r.durationSaved,
		taskContent: typeof r.taskContent === 'string' ? r.taskContent : '',
		baseline: parseBaseline(r.baseline),
		// Unknown means we can't tell; assume posted so a retry never duplicates it.
		baselinePosted: typeof r.baselinePosted === 'boolean' ? r.baselinePosted : true
	};
}

function parseDuration(raw: unknown): TaskDuration | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const { amount, unit } = raw as Record<string, unknown>;
	if (!isFiniteNumber(amount) || (unit !== 'minute' && unit !== 'day')) return null;
	return { amount, unit };
}

/** Lenient: a bad baseline is dropped, never the session's tracked time. */
function parseBaseline(raw: unknown): Baseline | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const r = raw as Record<string, unknown>;
	return makeBaseline(typeof r.due === 'string' ? r.due : null, parseDuration(r.duration));
}

/**
 * Parses stored JSON. Valid sessions are kept even if others are malformed, so
 * one bad entry never costs the user the rest of their tracked time.
 */
export function parseSessions(json: string | null): LoadResult {
	if (json === null) return { ok: true, sessions: {} };
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return {
			ok: false,
			sessions: {},
			reason: 'corrupt',
			message: 'Saved timers could not be read and were reset.'
		};
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		return {
			ok: false,
			sessions: {},
			reason: 'corrupt',
			message: 'Saved timers were in an unexpected format and were reset.'
		};
	}

	const sessions: SessionMap = {};
	const dropped: string[] = [];
	for (const [taskId, raw] of Object.entries(data)) {
		const session = parseSession(raw);
		if (session) sessions[taskId] = session;
		else dropped.push(taskId);
	}
	if (dropped.length > 0) {
		return {
			ok: false,
			sessions,
			reason: 'corrupt',
			message: `${dropped.length} saved timer(s) were unreadable and could not be restored.`
		};
	}
	return { ok: true, sessions };
}

export function loadSessions(storage: Storage | null | undefined): LoadResult {
	if (!storage) {
		return {
			ok: false,
			sessions: {},
			reason: 'unavailable',
			message: 'Browser storage is unavailable, so timers will not survive closing the browser.'
		};
	}
	let json: string | null;
	try {
		json = storage.getItem(STORAGE_KEY);
	} catch {
		return {
			ok: false,
			sessions: {},
			reason: 'unavailable',
			message: 'Browser storage is blocked, so timers will not survive closing the browser.'
		};
	}
	const result = parseSessions(json);
	if (!result.ok && result.reason === 'corrupt' && json !== null) {
		// Keep the raw data so the next save doesn't destroy it.
		try {
			storage.setItem(BACKUP_KEY, json);
			result.message += ` The original data was kept under "${BACKUP_KEY}".`;
		} catch {
			// Nothing more we can do; the message already tells the user.
		}
	}
	return result;
}

/** Returns false if the write failed. */
export function saveSessions(storage: Storage | null | undefined, sessions: SessionMap): boolean {
	if (!storage) return false;
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
		return true;
	} catch {
		return false;
	}
}

/** `localStorage`, or null if the browser refuses access. */
export function getBrowserStorage(): Storage | null {
	try {
		const storage = globalThis.localStorage;
		if (!storage) return null;
		const probe = `${STORAGE_KEY}:probe`;
		storage.setItem(probe, '1');
		storage.removeItem(probe);
		return storage;
	} catch {
		return null;
	}
}
