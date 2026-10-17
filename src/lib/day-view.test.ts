import { describe, expect, it } from 'vitest';
import { addDays, countByDay, dayKey, dueDayKey, dueTime, groupForDay } from './day-view';
import type { TaskSummary } from './todoist';

function task(id: string, due: Partial<NonNullable<TaskSummary['due']>> | null, extra = {}) {
	return {
		id,
		content: id,
		projectId: 'p',
		projectName: null,
		projectColor: null,
		sectionId: null,
		sectionName: null,
		url: '',
		priority: 1,
		order: 0,
		due: due ? { date: '', datetime: null, string: '', isRecurring: false, ...due } : null,
		duration: null,
		...extra
	} satisfies TaskSummary;
}

describe('day keys', () => {
	it('uses the given time zone', () => {
		const ms = Date.UTC(2026, 9, 17, 23, 30);
		expect(dayKey(ms, 'UTC')).toBe('2026-10-17');
		expect(dayKey(ms, 'Asia/Tokyo')).toBe('2026-10-18');
	});

	it('adds days across month and year ends', () => {
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
	});
});

describe('dueDayKey / dueTime', () => {
	it('reads all-day dates as written', () => {
		const due = task('a', { date: '2026-10-17' }).due;
		expect(dueDayKey(due, 'Asia/Tokyo')).toBe('2026-10-17');
		expect(dueTime(due)).toBeNull();
	});

	it('reads floating date-times as written', () => {
		const due = task('a', { date: '2026-10-17T14:05:00' }).due;
		expect(dueDayKey(due, 'Asia/Tokyo')).toBe('2026-10-17');
		expect(dueTime(due, 'Asia/Tokyo')).toBe('14:05');
	});

	it('converts fixed (UTC) date-times to the local day and time', () => {
		const due = task('a', { date: '2026-10-17', datetime: '2026-10-17T23:30:00Z' }).due;
		expect(dueDayKey(due, 'UTC')).toBe('2026-10-17');
		expect(dueDayKey(due, 'Asia/Tokyo')).toBe('2026-10-18');
		expect(dueTime(due, 'Asia/Tokyo')).toBe('08:30');
	});

	it('handles tasks with no due date', () => {
		expect(dueDayKey(null)).toBeNull();
		expect(dueTime(null)).toBeNull();
	});
});

describe('groupForDay', () => {
	const tasks = [
		task('undated', null),
		task('old', { date: '2026-10-10' }),
		task('yesterday', { date: '2026-10-16' }),
		task('today-p1', { date: '2026-10-17' }, { priority: 4 }),
		task('today-plain-2', { date: '2026-10-17' }, { order: 2 }),
		task('today-plain-1', { date: '2026-10-17' }, { order: 1 }),
		task('today-9am', { date: '2026-10-17T09:00:00' }),
		task('today-8am', { date: '2026-10-17T08:00:00' }),
		task('tomorrow', { date: '2026-10-18' })
	];
	const ids = (list: TaskSummary[]) => list.map((t) => t.id);

	it('shows overdue tasks only on today, oldest first', () => {
		const today = groupForDay(tasks, '2026-10-17', '2026-10-17', 'UTC');
		expect(ids(today.overdue)).toEqual(['old', 'yesterday']);

		const tomorrow = groupForDay(tasks, '2026-10-18', '2026-10-17', 'UTC');
		expect(tomorrow.overdue).toEqual([]);
		expect(ids(tomorrow.day)).toEqual(['tomorrow']);
	});

	it('orders a day by time, then priority, then Todoist order', () => {
		const { day } = groupForDay(tasks, '2026-10-17', '2026-10-17', 'UTC');
		expect(ids(day)).toEqual([
			'today-8am',
			'today-9am',
			'today-p1',
			'today-plain-1',
			'today-plain-2'
		]);
	});

	it('never includes undated tasks', () => {
		const { day, overdue } = groupForDay(tasks, '2026-10-17', '2026-10-17', 'UTC');
		expect([...ids(day), ...ids(overdue)]).not.toContain('undated');
	});

	it('counts tasks per day for the calendar', () => {
		const counts = countByDay(tasks, 'UTC');
		expect(counts.get('2026-10-17')).toBe(5);
		expect(counts.get('2026-10-18')).toBe(1);
		expect(counts.has('undefined')).toBe(false);
	});
});
