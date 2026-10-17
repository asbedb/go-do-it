// Pure timer logic. Every function takes `now` explicitly so tests control time.
// Elapsed time is always derived from timestamps, never from counted ticks.

export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

export interface Segment {
	/** Epoch ms. */
	start: number;
	/** Epoch ms. */
	end: number;
}

export interface TaskDuration {
	amount: number;
	unit: 'minute' | 'day';
}

/** What the task said before this session's timer first started. */
export interface Baseline {
	/** Formatted due date (and time), or null if the task had none. */
	due: string | null;
	duration: TaskDuration | null;
}

export interface Session {
	status: TimerStatus;
	accumulatedMs: number;
	/** Epoch ms when the current running span began, or null when not running. */
	runningSince: number | null;
	segments: Segment[];
	commentPosted: boolean;
	durationSaved: boolean;
	/** Task title at the time of tracking, so orphaned sessions can still be named. */
	taskContent: string;
	/** Captured on first Start; null if the task had no due date or duration. */
	baseline: Baseline | null;
	/** Whether the "before the timer" comment has been posted. */
	baselinePosted: boolean;
}

export type SessionMap = Record<string, Session>;

const MINUTE_MS = 60_000;

export function createSession(taskContent = ''): Session {
	return {
		status: 'idle',
		accumulatedMs: 0,
		runningSince: null,
		segments: [],
		commentPosted: false,
		durationSaved: false,
		taskContent,
		baseline: null,
		baselinePosted: false
	};
}

/** A baseline worth recording, or null if the task had neither a date nor a duration. */
export function makeBaseline(due: string | null, duration: TaskDuration | null): Baseline | null {
	return due || duration ? { due, duration } : null;
}

export function needsBaselineComment(session: Session): boolean {
	return session.baseline !== null && !session.baselinePosted;
}

export function markBaselinePosted(session: Session): Session {
	return { ...session, baselinePosted: true };
}

export function elapsedMs(session: Session, now: number): number {
	const running = session.runningSince === null ? 0 : Math.max(0, now - session.runningSince);
	return session.accumulatedMs + running;
}

export function start(session: Session, now: number): Session {
	if (session.status !== 'idle') return session;
	return { ...session, status: 'running', runningSince: now };
}

export function pause(session: Session, now: number): Session {
	if (session.status !== 'running' || session.runningSince === null) return session;
	const end = Math.max(now, session.runningSince);
	return {
		...session,
		status: 'paused',
		accumulatedMs: session.accumulatedMs + (end - session.runningSince),
		runningSince: null,
		segments: [...session.segments, { start: session.runningSince, end }]
	};
}

export function resume(session: Session, now: number): Session {
	if (session.status !== 'paused') return session;
	return { ...session, status: 'running', runningSince: now };
}

/** Pauses if needed and freezes the session for the Done flow. */
export function beginDone(session: Session, now: number): Session {
	if (session.status === 'idle' || session.status === 'done') return session;
	const paused = pause(session, now);
	return { ...paused, status: 'done' };
}

export function markCommentPosted(session: Session): Session {
	return { ...session, commentPosted: true };
}

export function markDurationSaved(session: Session): Session {
	return { ...session, durationSaved: true };
}

export function isDoneComplete(session: Session): boolean {
	return !needsBaselineComment(session) && session.commentPosted && session.durationSaved;
}

/** Whole minutes for Todoist's `duration.amount`: rounded up, never below 1. */
export function durationMinutes(ms: number): number {
	return Math.max(1, Math.ceil(ms / MINUTE_MS));
}

/** `h:mm:ss` for the running display. */
export function formatClock(ms: number): string {
	const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = totalSeconds % 60;
	return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** `2h 13m`, `45m`, `3h`. */
export function formatMinutes(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}

/** A Todoist `duration` for display: `45m`, `1h 30m`, `2d`. */
export function formatTaskDuration(d: { amount: number; unit: 'minute' | 'day' }): string {
	return d.unit === 'minute' ? formatMinutes(d.amount) : `${d.amount}d`;
}

export function runningCount(sessions: SessionMap): number {
	return Object.values(sessions).filter((s) => s.status === 'running').length;
}

// --- Session comment -------------------------------------------------------

interface DateParts {
	key: string;
	weekday: string;
	day: string;
	month: string;
	year: string;
	time: string;
}

function dateParts(ms: number, timeZone?: string): DateParts {
	const fmt = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	const parts: Record<string, string> = {};
	for (const p of fmt.formatToParts(new Date(ms))) parts[p.type] = p.value;
	return {
		key: `${parts.year}-${parts.month}-${parts.day}`,
		weekday: parts.weekday,
		day: parts.day,
		month: parts.month,
		year: parts.year,
		time: `${parts.hour}:${parts.minute}`
	};
}

function fullDate(p: DateParts): string {
	return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

function spanMinutesLabel(ms: number): string {
	const minutes = Math.round(ms / MINUTE_MS);
	return minutes === 0 ? '<1m' : formatMinutes(minutes);
}

function formatSpan(segment: Segment, timeZone?: string): string {
	const a = dateParts(segment.start, timeZone);
	const b = dateParts(segment.end, timeZone);
	const length = spanMinutesLabel(segment.end - segment.start);
	if (a.key === b.key) return `${fullDate(a)}, ${a.time}–${b.time} (${length})`;
	return `${fullDate(a)}, ${a.time} – ${fullDate(b)}, ${b.time} (${length})`;
}

function formatRange(first: Segment, last: Segment, timeZone?: string): string {
	const a = dateParts(first.start, timeZone);
	const b = dateParts(last.end, timeZone);
	if (a.key === b.key) return fullDate(a);
	const left = a.year === b.year ? `${a.weekday} ${a.day} ${a.month}` : fullDate(a);
	return `${left} – ${fullDate(b)}`;
}

/** `Sat 17 Oct 2026` for a `YYYY-MM-DD` calendar date (no time zone shift). */
export function formatDayKey(key: string): string {
	const [y, m, d] = key.split('-').map(Number);
	return fullDate(dateParts(Date.UTC(y, m - 1, d), 'UTC'));
}

/** `Sat 17 Oct 2026, 09:00` in `timeZone`. */
export function formatDateTime(ms: number, timeZone?: string): string {
	const p = dateParts(ms, timeZone);
	return `${fullDate(p)}, ${p.time}`;
}

/**
 * Expected-vs-actual line, or null when there's nothing to compare against.
 * Day-based durations aren't compared: they describe a span, not effort.
 */
export function formatVariance(
	expected: TaskDuration | null,
	actualMinutes: number
): string | null {
	if (!expected || expected.unit !== 'minute' || expected.amount <= 0) return null;
	const diff = actualMinutes - expected.amount;
	const head = `📊 Expected ${formatMinutes(expected.amount)}, took ${formatMinutes(actualMinutes)}`;
	if (diff === 0) return `${head}: right on estimate`;
	const pct = Math.round((Math.abs(diff) / expected.amount) * 100);
	const sign = diff > 0 ? '+' : '−';
	const word = diff > 0 ? 'over' : 'under';
	return `${head}: ${formatMinutes(Math.abs(diff))} ${word} (${sign}${pct}%)`;
}

/** Comment recording the task's date and duration before the timer first started. */
export function formatBaselineComment(
	baseline: Baseline,
	startedAt: number,
	timeZone?: string
): string {
	return [
		`📋 Before timer (started ${formatDateTime(startedAt, timeZone)}):`,
		`- Due: ${baseline.due ?? 'none'}`,
		`- Duration: ${baseline.duration ? formatTaskDuration(baseline.duration) : 'none'}`
	].join('\n');
}

/** When the session's timer first started. */
export function sessionStart(session: Session): number | null {
	const first = Math.min(...session.segments.map((s) => s.start));
	if (Number.isFinite(first)) return first;
	return session.runningSince;
}

/**
 * Markdown comment logging a finished session. Dates and times are rendered in
 * `timeZone` (defaults to the runtime's local zone).
 */
export function formatSessionComment(session: Session, timeZone?: string): string {
	const minutes = durationMinutes(session.accumulatedMs);
	const total = formatMinutes(minutes);
	const variance = formatVariance(session.baseline?.duration ?? null, minutes);
	const segments = [...session.segments].sort((x, y) => x.start - y.start);
	const lines =
		segments.length === 0
			? [`⏱ Session: ${total}`]
			: [
					`⏱ Session: ${total} (${formatRange(segments[0], segments[segments.length - 1], timeZone)})`,
					...segments.map((s) => `- ${formatSpan(s, timeZone)}`)
				];
	if (variance) lines.push(variance);
	return lines.join('\n');
}
