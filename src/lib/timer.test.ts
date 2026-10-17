import { describe, expect, it } from 'vitest';
import {
	beginDone,
	createSession,
	durationMinutes,
	elapsedMs,
	formatClock,
	formatMinutes,
	formatSessionComment,
	pause,
	resume,
	runningCount,
	start,
	type Session
} from './timer';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 17, 9, 0); // Sat 17 Oct 2026, 09:00 UTC

describe('timer math', () => {
	it('starts idle with nothing tracked', () => {
		const s = createSession();
		expect(s.status).toBe('idle');
		expect(elapsedMs(s, T0)).toBe(0);
	});

	it('computes elapsed from runningSince while running', () => {
		const s = start(createSession(), T0);
		expect(s.status).toBe('running');
		expect(s.runningSince).toBe(T0);
		expect(elapsedMs(s, T0 + 5 * MIN)).toBe(5 * MIN);
	});

	it('accumulates across pause/resume and records segments', () => {
		let s = start(createSession(), T0);
		s = pause(s, T0 + 10 * MIN);
		expect(s.status).toBe('paused');
		expect(s.runningSince).toBeNull();
		expect(s.accumulatedMs).toBe(10 * MIN);
		// Time passing while paused doesn't count.
		expect(elapsedMs(s, T0 + 60 * MIN)).toBe(10 * MIN);

		s = resume(s, T0 + 60 * MIN);
		expect(elapsedMs(s, T0 + 65 * MIN)).toBe(15 * MIN);
		s = pause(s, T0 + 70 * MIN);
		expect(s.accumulatedMs).toBe(20 * MIN);
		expect(s.segments).toEqual([
			{ start: T0, end: T0 + 10 * MIN },
			{ start: T0 + 60 * MIN, end: T0 + 70 * MIN }
		]);
	});

	it('ignores transitions that are invalid for the current state', () => {
		const idle = createSession();
		expect(pause(idle, T0)).toBe(idle);
		expect(resume(idle, T0)).toBe(idle);
		const running = start(idle, T0);
		expect(start(running, T0 + MIN)).toBe(running);
		expect(resume(running, T0 + MIN)).toBe(running);
	});

	it('does not mutate the input session', () => {
		const s = start(createSession(), T0);
		const snapshot = structuredClone(s);
		pause(s, T0 + MIN);
		expect(s).toEqual(snapshot);
	});

	it('includes time the app was closed when restoring a running session', () => {
		const s = start(createSession(), T0);
		const restored: Session = JSON.parse(JSON.stringify(s));
		expect(elapsedMs(restored, T0 + 3 * 60 * MIN)).toBe(3 * 60 * MIN);
	});

	it('never goes negative if the clock moves backwards', () => {
		const s = start(createSession(), T0);
		expect(elapsedMs(s, T0 - MIN)).toBe(0);
		expect(pause(s, T0 - MIN).accumulatedMs).toBe(0);
	});

	it('beginDone pauses a running session and freezes it', () => {
		let s = start(createSession(), T0);
		s = beginDone(s, T0 + 30 * MIN);
		expect(s.status).toBe('done');
		expect(s.runningSince).toBeNull();
		expect(s.accumulatedMs).toBe(30 * MIN);
		expect(s.segments).toHaveLength(1);
		// Repeating beginDone (a retry) changes nothing.
		expect(beginDone(s, T0 + 90 * MIN)).toBe(s);
	});

	it('beginDone on a paused session keeps its time', () => {
		const s = pause(start(createSession(), T0), T0 + 5 * MIN);
		const d = beginDone(s, T0 + 50 * MIN);
		expect(d.status).toBe('done');
		expect(d.accumulatedMs).toBe(5 * MIN);
		expect(d.segments).toEqual(s.segments);
	});
});

describe('durationMinutes', () => {
	it.each([
		[0, 1],
		[1, 1],
		[59_999, 1],
		[MIN, 1],
		[MIN + 1, 2],
		[133 * MIN, 133],
		[133 * MIN + 500, 134]
	])('%i ms -> %i min', (ms, minutes) => {
		expect(durationMinutes(ms)).toBe(minutes);
	});

	it('never returns 0 and always returns an integer', () => {
		for (const ms of [0, 0.5, 1, 1234, 60_000.4, 7_777_777]) {
			const m = durationMinutes(ms);
			expect(Number.isInteger(m)).toBe(true);
			expect(m).toBeGreaterThanOrEqual(1);
		}
	});
});

describe('formatting', () => {
	it('formats the running clock as h:mm:ss', () => {
		expect(formatClock(0)).toBe('0:00:00');
		expect(formatClock(59_999)).toBe('0:00:59');
		expect(formatClock(61_000)).toBe('0:01:01');
		expect(formatClock(10 * 3600_000 + 5 * MIN + 7000)).toBe('10:05:07');
	});

	it('formats whole minutes', () => {
		expect(formatMinutes(45)).toBe('45m');
		expect(formatMinutes(60)).toBe('1h');
		expect(formatMinutes(133)).toBe('2h 13m');
	});

	it('counts running timers', () => {
		expect(
			runningCount({
				a: start(createSession(), T0),
				b: pause(start(createSession(), T0), T0 + 1),
				c: start(createSession(), T0)
			})
		).toBe(2);
	});
});

function sessionFrom(segments: [number, number][]): Session {
	let s = createSession('Task');
	for (const [a, b] of segments) {
		s = s.status === 'idle' ? start(s, a) : resume(s, a);
		s = pause(s, b);
	}
	return beginDone(s, segments.at(-1)?.[1] ?? T0);
}

const at = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h, m);

describe('formatSessionComment', () => {
	it('shows a single date in the header for a one-day session', () => {
		const s = sessionFrom([
			[at(17, 9, 2), at(17, 9, 45)],
			[at(17, 10, 10), at(17, 10, 50)]
		]);
		expect(formatSessionComment(s, 'UTC')).toBe(
			[
				'⏱ Session: 1h 23m (Sat 17 Oct 2026)',
				'- Sat 17 Oct 2026, 09:02–09:45 (43m)',
				'- Sat 17 Oct 2026, 10:10–10:50 (40m)'
			].join('\n')
		);
	});

	it('shows a date range and dates on every line for a multi-day session', () => {
		const s = sessionFrom([
			[at(17, 9, 2), at(17, 9, 45)],
			[at(17, 10, 10), at(17, 10, 50)],
			[at(18, 14, 0), at(18, 14, 50)]
		]);
		expect(formatSessionComment(s, 'UTC')).toBe(
			[
				'⏱ Session: 2h 13m (Sat 17 Oct – Sun 18 Oct 2026)',
				'- Sat 17 Oct 2026, 09:02–09:45 (43m)',
				'- Sat 17 Oct 2026, 10:10–10:50 (40m)',
				'- Sun 18 Oct 2026, 14:00–14:50 (50m)'
			].join('\n')
		);
	});

	it('shows both dates for a span crossing midnight', () => {
		const s = sessionFrom([[at(17, 23, 30), at(18, 0, 15)]]);
		expect(formatSessionComment(s, 'UTC')).toBe(
			[
				'⏱ Session: 45m (Sat 17 Oct – Sun 18 Oct 2026)',
				'- Sat 17 Oct 2026, 23:30 – Sun 18 Oct 2026, 00:15 (45m)'
			].join('\n')
		);
	});

	it('includes the year on both sides when a session crosses New Year', () => {
		const s = sessionFrom([[Date.UTC(2026, 11, 31, 23, 0), Date.UTC(2027, 0, 1, 1, 0)]]);
		expect(formatSessionComment(s, 'UTC').split('\n')[0]).toBe(
			'⏱ Session: 2h (Thu 31 Dec 2026 – Fri 1 Jan 2027)'
		);
	});

	it('renders in the given time zone', () => {
		// 23:30 UTC is 08:30 the next day in Tokyo.
		const s = sessionFrom([[at(17, 23, 30), at(17, 23, 50)]]);
		expect(formatSessionComment(s, 'Asia/Tokyo')).toBe(
			['⏱ Session: 20m (Sun 18 Oct 2026)', '- Sun 18 Oct 2026, 08:30–08:50 (20m)'].join('\n')
		);
	});

	it('rounds the header total up, matching the duration sent to Todoist', () => {
		const s = sessionFrom([[at(17, 9, 0), at(17, 9, 0) + 20_000]]);
		expect(formatSessionComment(s, 'UTC')).toBe(
			['⏱ Session: 1m (Sat 17 Oct 2026)', '- Sat 17 Oct 2026, 09:00–09:00 (<1m)'].join('\n')
		);
	});
});
