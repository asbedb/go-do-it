import { describe, expect, it } from 'vitest';
import { BACKUP_KEY, loadSessions, parseSessions, saveSessions, STORAGE_KEY } from './persistence';
import { MemoryStorage } from './test-utils';
import {
	beginDone,
	createSession,
	markCommentPosted,
	pause,
	start,
	type Session,
	type SessionMap
} from './timer';

const T0 = Date.UTC(2026, 9, 17, 9, 0);

function sample(): SessionMap {
	return {
		running: start(createSession('Write report'), T0),
		paused: pause(start(createSession('Email'), T0), T0 + 60_000),
		halfDone: markCommentPosted(beginDone(start(createSession('Review'), T0), T0 + 120_000))
	};
}

describe('persistence', () => {
	it('round-trips every session field', () => {
		const storage = new MemoryStorage();
		const sessions = sample();
		expect(saveSessions(storage, sessions)).toBe(true);
		const loaded = loadSessions(storage);
		expect(loaded).toEqual({ ok: true, sessions });
	});

	it('uses the versioned localStorage key', () => {
		const storage = new MemoryStorage();
		saveSessions(storage, sample());
		expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
	});

	it('starts empty when nothing is stored', () => {
		expect(loadSessions(new MemoryStorage())).toEqual({ ok: true, sessions: {} });
	});

	it('does not crash on invalid JSON, and backs it up', () => {
		const storage = new MemoryStorage();
		storage.setItem(STORAGE_KEY, '{not json');
		const result = loadSessions(storage);
		expect(result.ok).toBe(false);
		expect(result.sessions).toEqual({});
		expect(storage.getItem(BACKUP_KEY)).toBe('{not json');
	});

	it.each([['[]'], ['42'], ['null'], ['"text"']])('rejects non-object payload %s', (json) => {
		const result = parseSessions(json);
		expect(result.ok).toBe(false);
		expect(result.sessions).toEqual({});
	});

	it('keeps valid sessions when one entry is malformed', () => {
		const good = sample();
		const json = JSON.stringify({
			...good,
			bad1: { status: 'running', accumulatedMs: 0, runningSince: null },
			bad2: { ...good.paused, status: 'exploded' },
			bad3: { ...good.paused, segments: [{ start: 5, end: 1 }] }
		});
		const result = parseSessions(json);
		expect(result.ok).toBe(false);
		expect(result.sessions).toEqual(good);
		if (!result.ok) expect(result.message).toMatch(/3 saved timer/);
	});

	it('rejects a running session with no runningSince, or a paused one with it', () => {
		const p = sample().paused;
		expect(parseSessions(JSON.stringify({ a: { ...p, status: 'running' } })).ok).toBe(false);
		expect(parseSessions(JSON.stringify({ a: { ...p, runningSince: T0 } })).ok).toBe(false);
	});

	it('defaults a missing taskContent instead of dropping the session', () => {
		const legacy: Partial<Session> = sample().paused;
		delete legacy.taskContent;
		const result = parseSessions(JSON.stringify({ a: legacy }));
		expect(result.ok).toBe(true);
		expect(result.sessions.a.taskContent).toBe('');
	});

	it('reports unavailable storage', () => {
		expect(loadSessions(null)).toMatchObject({ ok: false, reason: 'unavailable' });
		const blocked = new MemoryStorage();
		blocked.fail.get = true;
		expect(loadSessions(blocked)).toMatchObject({ ok: false, reason: 'unavailable' });
	});

	it('reports a failed write instead of throwing', () => {
		const storage = new MemoryStorage();
		storage.fail.set = true;
		expect(saveSessions(storage, sample())).toBe(false);
		expect(saveSessions(null, sample())).toBe(false);
	});
});
