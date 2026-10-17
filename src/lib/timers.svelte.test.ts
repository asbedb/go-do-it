import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from './persistence';
import { MemoryStorage } from './test-utils';
import { Timers } from './timers.svelte';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 17, 9, 0);

function setup(storage = new MemoryStorage()) {
	let now = T0;
	const api = {
		postComment: vi.fn<(id: string, content: string) => Promise<void>>().mockResolvedValue(),
		saveDuration: vi.fn<(id: string, minutes: number) => Promise<void>>().mockResolvedValue()
	};
	const timers = new Timers({ now: () => now, storage, api, timeZone: 'UTC' });
	timers.restore();
	const advance = (ms: number) => (now += ms);
	/** Simulates closing the browser and opening the app again later. */
	const reopen = (afterMs: number) => {
		timers.destroy();
		now += afterMs;
		const next = new Timers({ now: () => now, storage, api, timeZone: 'UTC' });
		next.restore();
		created.push(next);
		return next;
	};
	created.push(timers);
	return { timers, api, storage, advance, reopen };
}

const created: Timers[] = [];
afterEach(() => {
	for (const t of created.splice(0)) t.destroy();
	vi.useRealTimers();
});

describe('Timers store', () => {
	it('runs several timers independently', () => {
		const { timers, advance } = setup();
		timers.start('a', 'A');
		advance(5 * MIN);
		timers.start('b', 'B');
		expect(timers.runningCount).toBe(2);
		expect(timers.elapsed('a')).toBe(5 * MIN);
		expect(timers.elapsed('b')).toBe(0);

		advance(5 * MIN);
		timers.pause('a');
		expect(timers.get('a').status).toBe('paused');
		expect(timers.get('b').status).toBe('running');
		expect(timers.runningCount).toBe(1);

		advance(5 * MIN);
		expect(timers.elapsed('a')).toBe(10 * MIN);
		expect(timers.elapsed('b')).toBe(10 * MIN);
	});

	it('finishing one timer leaves the others untouched', async () => {
		const { timers, advance } = setup();
		timers.start('a', 'A');
		timers.start('b', 'B');
		advance(3 * MIN);
		const before = structuredClone($state.snapshot(timers.get('b')));

		const outcome = await timers.done('a');

		expect(outcome.ok).toBe(true);
		expect(timers.get('a').status).toBe('idle');
		expect(timers.get('a').accumulatedMs).toBe(0);
		expect($state.snapshot(timers.get('b'))).toEqual(before);
		expect(timers.elapsed('b')).toBe(3 * MIN);
	});

	it('previews Done without changing the running session', () => {
		const { timers, api, advance } = setup();
		timers.start('a', 'A');
		advance(12 * MIN + 1);
		const before = $state.snapshot(timers.get('a'));

		const preview = timers.preview('a');

		expect(preview.minutes).toBe(13);
		expect(preview.comment).toMatch(
			/^⏱ Session: 13m \(Sat 17 Oct 2026\)\n- Sat 17 Oct 2026, 09:00–09:12/
		);
		expect($state.snapshot(timers.get('a'))).toEqual(before);
		expect(api.postComment).not.toHaveBeenCalled();
	});

	it('remembers the comment it posted so the task can show it', async () => {
		const { timers, api, advance } = setup();
		timers.start('a', 'A');
		advance(5 * MIN);
		await timers.done('a');

		expect(timers.lastLogged.a.minutes).toBe(5);
		expect(timers.lastLogged.a.comment).toBe(api.postComment.mock.calls[0][1]);
		timers.dismissLogged('a');
		expect(timers.lastLogged.a).toBeUndefined();
	});

	it('records nothing as logged when Done fails', async () => {
		const { timers, api, advance } = setup();
		api.saveDuration.mockRejectedValueOnce(new Error('nope'));
		timers.start('a', 'A');
		advance(MIN);
		await timers.done('a');
		expect(timers.lastLogged.a).toBeUndefined();
	});

	it('persists on every transition', () => {
		const { timers, storage, advance } = setup();
		const saved = () => JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
		timers.start('a', 'A');
		expect(saved().a.status).toBe('running');
		advance(MIN);
		timers.pause('a');
		expect(saved().a).toMatchObject({ status: 'paused', accumulatedMs: MIN });
		timers.resume('a');
		expect(saved().a.status).toBe('running');
	});

	it('restores paused and running sessions after a browser restart', () => {
		const { timers, advance, reopen } = setup();
		timers.start('paused', 'P');
		timers.start('running', 'R');
		advance(10 * MIN);
		timers.pause('paused');

		const later = reopen(2 * 60 * MIN);

		expect(later.get('paused').status).toBe('paused');
		expect(later.elapsed('paused')).toBe(10 * MIN);
		expect(later.get('running').status).toBe('running');
		expect(later.elapsed('running')).toBe(130 * MIN);
		expect(later.runningCount).toBe(1);
	});

	it('restores a half-finished Done and retries without a duplicate comment', async () => {
		const { timers, api, advance, reopen } = setup();
		api.saveDuration.mockRejectedValueOnce(new Error('Task needs a due date'));
		timers.start('a', 'A');
		advance(20 * MIN);

		const failed = await timers.done('a');
		expect(failed).toMatchObject({ ok: false, step: 'duration', error: 'Task needs a due date' });
		expect(timers.failures.a).toEqual({ step: 'duration', error: 'Task needs a due date' });
		expect(timers.elapsed('a')).toBe(20 * MIN);

		const later = reopen(60 * MIN);
		expect(later.get('a')).toMatchObject({
			status: 'done',
			commentPosted: true,
			durationSaved: false
		});
		// Time is frozen once Done begins.
		expect(later.elapsed('a')).toBe(20 * MIN);

		const retried = await later.done('a');
		expect(retried.ok).toBe(true);
		expect(api.postComment).toHaveBeenCalledTimes(1);
		expect(api.saveDuration).toHaveBeenLastCalledWith('a', 20);
		expect(later.get('a').status).toBe('idle');
	});

	it('keeps local time when the comment fails', async () => {
		const { timers, api, advance } = setup();
		api.postComment.mockRejectedValueOnce(new Error('Forbidden'));
		timers.start('a', 'A');
		advance(7 * MIN);
		const outcome = await timers.done('a');
		expect(outcome).toMatchObject({ ok: false, step: 'comment' });
		expect(api.saveDuration).not.toHaveBeenCalled();
		expect(timers.get('a')).toMatchObject({ status: 'done', accumulatedMs: 7 * MIN });
	});

	it('warns but keeps working when storage is unavailable', () => {
		const storage = new MemoryStorage();
		storage.fail.get = true;
		storage.fail.set = true;
		const { timers, advance } = setup(storage);
		expect(timers.storageWarning).toMatch(/not survive/);
		timers.start('a', 'A');
		advance(MIN);
		expect(timers.elapsed('a')).toBe(MIN);
	});

	it('recovers from corrupt storage with a warning', () => {
		const storage = new MemoryStorage();
		storage.setItem(STORAGE_KEY, '<<<garbage');
		const { timers } = setup(storage);
		expect(timers.sessions).toEqual({});
		expect(timers.storageWarning).toBeTruthy();
	});

	it('lists sessions whose task is no longer active, without dropping them', () => {
		const { timers, advance } = setup();
		timers.start('gone', 'Old task');
		timers.start('here', 'Current');
		advance(MIN);
		timers.pause('gone');
		expect(timers.orphans(new Set(['here'])).map(([id]) => id)).toEqual(['gone']);
		expect(timers.get('gone').accumulatedMs).toBe(MIN);
	});

	it('runs one shared ticker only while a timer is running', () => {
		vi.useFakeTimers();
		const { timers } = setup();
		expect(vi.getTimerCount()).toBe(0);
		timers.start('a', 'A');
		timers.start('b', 'B');
		expect(vi.getTimerCount()).toBe(1);
		timers.pause('a');
		expect(vi.getTimerCount()).toBe(1);
		timers.pause('b');
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('Timers store: baseline on Start', () => {
	const baseline = { due: 'Sat 17 Oct 2026', duration: { amount: 30, unit: 'minute' as const } };
	const baselinePosts = (api: ReturnType<typeof setup>['api']) =>
		api.postComment.mock.calls.filter(([, c]) => c.startsWith('📋')).length;

	it('posts the earlier date and duration once, on the first Start only', async () => {
		const { timers, api, advance } = setup();
		await timers.start('a', 'A', baseline);
		expect(baselinePosts(api)).toBe(1);
		expect(timers.get('a').baselinePosted).toBe(true);

		advance(MIN);
		timers.pause('a');
		timers.resume('a');
		expect(timers.start('a', 'A', baseline)).toBeNull();
		expect(baselinePosts(api)).toBe(1);
	});

	it('posts nothing at Start when the task had no date or duration', () => {
		const { timers, api } = setup();
		expect(timers.start('a', 'A', null)).toBeNull();
		expect(api.postComment).not.toHaveBeenCalled();
	});

	it('retries a failed Start-time baseline at Done, exactly once', async () => {
		const { timers, api, advance } = setup();
		api.postComment.mockRejectedValueOnce(new Error('offline'));
		const outcome = await timers.start('a', 'A', baseline);
		expect(outcome).toEqual({ ok: false, error: 'offline' });
		expect(timers.get('a').baselinePosted).toBe(false);

		advance(40 * MIN);
		expect((await timers.done('a')).ok).toBe(true);
		const contents = api.postComment.mock.calls.map(([, c]) => c);
		// The failed attempt, then the retry, then the session comment.
		expect(contents.filter((c) => c.startsWith('📋'))).toHaveLength(2);
		expect(contents.at(-1)).toMatch(/📊 Expected 30m, took 40m: 10m over \(\+33%\)$/);
	});

	it('does not double-post when Done is clicked while the baseline is still sending', async () => {
		const { timers, api, advance } = setup();
		let release!: () => void;
		api.postComment.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
		const posting = timers.start('a', 'A', baseline);
		advance(5 * MIN);
		const done = timers.done('a');
		release();
		await posting;
		expect((await done).ok).toBe(true);
		expect(baselinePosts(api)).toBe(1);
	});

	it('keeps the baseline across a browser restart', async () => {
		const { timers, api, reopen } = setup();
		api.postComment.mockRejectedValueOnce(new Error('offline'));
		await timers.start('a', 'A', baseline);
		const later = reopen(10 * MIN);
		expect(later.get('a')).toMatchObject({ baseline, baselinePosted: false });
	});
});
