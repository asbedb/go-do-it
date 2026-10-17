// "Before the timer" baseline comments and the expected-vs-actual variance line.
import { describe, expect, it, vi } from 'vitest';
import { formatDueLabel } from './day-view';
import { runDoneFlow, type DoneDeps } from './done-flow';
import { parseSessions } from './persistence';
import {
	beginDone,
	createSession,
	formatBaselineComment,
	formatSessionComment,
	formatVariance,
	isDoneComplete,
	makeBaseline,
	pause,
	start,
	type Baseline,
	type Session
} from './timer';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 17, 9, 0); // Sat 17 Oct 2026, 09:00 UTC

function tracked(minutes: number, baseline: Baseline | null, baselinePosted = true): Session {
	const s = start({ ...createSession('Task'), baseline, baselinePosted }, T0);
	return beginDone(pause(s, T0 + minutes * MIN), T0 + minutes * MIN);
}

describe('makeBaseline', () => {
	it('is null when the task had neither a date nor a duration', () => {
		expect(makeBaseline(null, null)).toBeNull();
	});

	it('keeps whichever of the two the task had', () => {
		expect(makeBaseline('Sat 17 Oct 2026', null)).toEqual({
			due: 'Sat 17 Oct 2026',
			duration: null
		});
		expect(makeBaseline(null, { amount: 30, unit: 'minute' })).toEqual({
			due: null,
			duration: { amount: 30, unit: 'minute' }
		});
	});
});

describe('formatBaselineComment', () => {
	it('states the date and duration the task had before the timer', () => {
		const comment = formatBaselineComment(
			{ due: 'Sat 17 Oct 2026, 14:00', duration: { amount: 45, unit: 'minute' } },
			T0,
			'UTC'
		);
		expect(comment).toBe(
			[
				'📋 Before timer (started Sat 17 Oct 2026, 09:00):',
				'- Due: Sat 17 Oct 2026, 14:00',
				'- Duration: 45m'
			].join('\n')
		);
	});

	it('says "none" for whichever is missing', () => {
		const comment = formatBaselineComment(
			{ due: null, duration: { amount: 2, unit: 'day' } },
			T0,
			'UTC'
		);
		expect(comment).toContain('- Due: none');
		expect(comment).toContain('- Duration: 2d');
	});
});

describe('formatDueLabel', () => {
	const due = (extra: object) => ({
		date: '2026-10-17',
		datetime: null,
		string: 'today',
		isRecurring: false,
		...extra
	});

	it('formats all-day, timed and recurring due dates', () => {
		expect(formatDueLabel(due({}))).toBe('Sat 17 Oct 2026');
		expect(formatDueLabel(due({ date: '2026-10-17T14:00:00' }))).toBe('Sat 17 Oct 2026, 14:00');
		expect(formatDueLabel(due({ isRecurring: true, string: 'every day' }))).toBe(
			'Sat 17 Oct 2026 (repeats every day)'
		);
	});

	it('is null for tasks with no due date', () => {
		expect(formatDueLabel(null)).toBeNull();
	});
});

describe('formatVariance', () => {
	const expected = (amount: number) => ({ amount, unit: 'minute' as const });

	it.each([
		[45, 52, '📊 Expected 45m, took 52m: 7m over (+16%)'],
		[60, 45, '📊 Expected 1h, took 45m: 15m under (−25%)'],
		[30, 30, '📊 Expected 30m, took 30m: right on estimate'],
		[60, 150, '📊 Expected 1h, took 2h 30m: 1h 30m over (+150%)']
	])('expected %im, took %im', (exp, actual, line) => {
		expect(formatVariance(expected(exp), actual)).toBe(line);
	});

	it('has nothing to compare without a minute-based estimate', () => {
		expect(formatVariance(null, 10)).toBeNull();
		expect(formatVariance({ amount: 1, unit: 'day' }, 10)).toBeNull();
	});
});

describe('session comment variance', () => {
	it('ends with the variance against the earlier duration', () => {
		const s = tracked(52, { due: null, duration: { amount: 45, unit: 'minute' } });
		const lines = formatSessionComment(s, 'UTC').split('\n');
		expect(lines[0]).toBe('⏱ Session: 52m (Sat 17 Oct 2026)');
		expect(lines.at(-1)).toBe('📊 Expected 45m, took 52m: 7m over (+16%)');
	});

	it('has no variance line when there was no earlier duration', () => {
		const s = tracked(10, { due: 'Sat 17 Oct 2026', duration: null });
		expect(formatSessionComment(s, 'UTC')).not.toContain('📊');
	});
});

describe('Done flow with a baseline', () => {
	function deps() {
		const posted: string[] = [];
		return {
			posted,
			postComment: vi.fn(async (_id: string, content: string) => void posted.push(content)),
			saveDuration: vi.fn<DoneDeps['saveDuration']>().mockResolvedValue(undefined),
			onProgress: vi.fn<DoneDeps['onProgress']>(),
			timeZone: 'UTC'
		};
	}
	const baseline: Baseline = { due: 'Sat 17 Oct 2026', duration: { amount: 20, unit: 'minute' } };

	it('posts a baseline that failed at Start before the session comment', async () => {
		const d = deps();
		const result = await runDoneFlow('t', tracked(25, baseline, false), d);
		expect(result.ok).toBe(true);
		expect(d.posted).toHaveLength(2);
		expect(d.posted[0]).toMatch(/^📋 Before timer/);
		expect(d.posted[1]).toMatch(/^⏱ Session: 25m/);
		expect(d.saveDuration).toHaveBeenCalledWith('t', 25);
	});

	it('does not repost a baseline that was already posted', async () => {
		const d = deps();
		await runDoneFlow('t', tracked(25, baseline, true), d);
		expect(d.posted).toHaveLength(1);
		expect(d.posted[0]).toMatch(/^⏱ Session/);
	});

	it('stops with step "baseline" if it fails again, keeping the time', async () => {
		const d = deps();
		d.postComment.mockRejectedValueOnce(new Error('offline'));
		const result = await runDoneFlow('t', tracked(25, baseline, false), d);
		expect(result).toMatchObject({ ok: false, step: 'baseline', error: 'offline' });
		expect(result.session.accumulatedMs).toBe(25 * MIN);
		expect(d.saveDuration).not.toHaveBeenCalled();
		expect(isDoneComplete(result.session)).toBe(false);
	});
});

describe('baseline persistence', () => {
	const stored = (extra: object) =>
		JSON.stringify({ a: { ...tracked(5, null), status: 'paused', ...extra } });

	it('round-trips a baseline', () => {
		const result = parseSessions(
			stored({
				baseline: { due: 'x', duration: { amount: 5, unit: 'minute' } },
				baselinePosted: false
			})
		);
		expect(result.ok).toBe(true);
		expect(result.sessions.a).toMatchObject({
			baseline: { due: 'x', duration: { amount: 5, unit: 'minute' } },
			baselinePosted: false
		});
	});

	it('loads sessions saved before baselines existed', () => {
		const legacy = JSON.parse(stored({}));
		delete legacy.a.baseline;
		delete legacy.a.baselinePosted;
		const result = parseSessions(JSON.stringify(legacy));
		expect(result.ok).toBe(true);
		expect(result.sessions.a).toMatchObject({ baseline: null, baselinePosted: true });
	});

	it('drops a malformed baseline but keeps the tracked time', () => {
		const result = parseSessions(stored({ baseline: { due: 42, duration: 'soon' } }));
		expect(result.ok).toBe(true);
		expect(result.sessions.a.baseline).toBeNull();
		expect(result.sessions.a.accumulatedMs).toBe(5 * MIN);
	});
});
