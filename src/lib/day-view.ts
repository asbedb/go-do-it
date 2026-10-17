// Pure helpers for the daily view: which tasks fall on a day, in what order.
// Day keys are `YYYY-MM-DD` in the user's local time zone (or `timeZone`).
import { formatDayKey } from './timer.js';
import type { TaskSummary } from './todoist.js';

type Due = NonNullable<TaskSummary['due']>;

/** Matches a trailing `Z` or `±hh:mm` offset, i.e. a fixed instant. */
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

function parts(ms: number, timeZone?: string): Record<string, string> {
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	const out: Record<string, string> = {};
	for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
	return out;
}

export function dayKey(ms: number, timeZone?: string): string {
	const p = parts(ms, timeZone);
	return `${p.year}-${p.month}-${p.day}`;
}

/** Shifts a `YYYY-MM-DD` key by whole days. */
export function addDays(key: string, days: number): string {
	const [y, m, d] = key.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d + days));
	return date.toISOString().slice(0, 10);
}

/** The day a task is due on, or null if it has no due date. */
export function dueDayKey(due: Due | null, timeZone?: string): string | null {
	if (!due) return null;
	const stamp = due.datetime ?? due.date;
	if (HAS_ZONE.test(stamp)) {
		const ms = Date.parse(stamp);
		if (!Number.isNaN(ms)) return dayKey(ms, timeZone);
	}
	// Floating date/time: the calendar date as written.
	return stamp.slice(0, 10);
}

/** `HH:MM` the task is due at, or null for all-day tasks. */
export function dueTime(due: Due | null, timeZone?: string): string | null {
	if (!due) return null;
	const stamp = due.datetime ?? (due.date.length > 10 ? due.date : null);
	if (!stamp) return null;
	if (HAS_ZONE.test(stamp)) {
		const ms = Date.parse(stamp);
		if (Number.isNaN(ms)) return null;
		const p = parts(ms, timeZone);
		return `${p.hour}:${p.minute}`;
	}
	const match = /T(\d{2}):(\d{2})/.exec(stamp);
	return match ? `${match[1]}:${match[2]}` : null;
}

/** Timed tasks first, by time; then by priority (high first); then Todoist order. */
function compareWithinDay(timeZone?: string) {
	return (a: TaskSummary, b: TaskSummary): number => {
		const ta = dueTime(a.due, timeZone);
		const tb = dueTime(b.due, timeZone);
		if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
		if (ta && !tb) return -1;
		if (!ta && tb) return 1;
		if (a.priority !== b.priority) return b.priority - a.priority;
		return a.order - b.order;
	};
}

export interface DayGroups {
	/** Only filled when viewing today, as in Todoist's Today view. */
	overdue: TaskSummary[];
	day: TaskSummary[];
}

export function groupForDay(
	tasks: readonly TaskSummary[],
	day: string,
	today: string,
	timeZone?: string
): DayGroups {
	const within = compareWithinDay(timeZone);
	const onDay: TaskSummary[] = [];
	const overdue: { task: TaskSummary; key: string }[] = [];

	for (const task of tasks) {
		const key = dueDayKey(task.due, timeZone);
		if (key === null) continue;
		if (key === day) onDay.push(task);
		else if (day === today && key < today) overdue.push({ task, key });
	}

	overdue.sort((a, b) => (a.key !== b.key ? (a.key < b.key ? -1 : 1) : within(a.task, b.task)));
	return { overdue: overdue.map((o) => o.task), day: onDay.sort(within) };
}

/** Number of tasks due on each day, for marking the calendar. */
export function countByDay(tasks: readonly TaskSummary[], timeZone?: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const task of tasks) {
		const key = dueDayKey(task.due, timeZone);
		if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/** `Sat 17 Oct 2026, 14:00 (repeats every day)`, for comments. */
export function formatDueLabel(due: Due | null, timeZone?: string): string | null {
	const key = dueDayKey(due, timeZone);
	if (!due || !key) return null;
	const time = dueTime(due, timeZone);
	const when = time ? `${formatDayKey(key)}, ${time}` : formatDayKey(key);
	return due.isRecurring ? `${when} (repeats ${due.string})` : when;
}
