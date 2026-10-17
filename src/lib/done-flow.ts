import {
	durationMinutes,
	formatBaselineComment,
	formatSessionComment,
	isDoneComplete,
	markBaselinePosted,
	markCommentPosted,
	markDurationSaved,
	needsBaselineComment,
	sessionStart,
	type Session
} from './timer.js';

export type DoneStep = 'baseline' | 'comment' | 'duration';

export interface DoneDeps {
	postComment(taskId: string, content: string): Promise<void>;
	saveDuration(taskId: string, minutes: number): Promise<void>;
	/** Called after each successful step so progress is persisted immediately. */
	onProgress(session: Session): void;
	timeZone?: string;
}

export type DoneResult =
	{ ok: true; session: Session } | { ok: false; session: Session; step: DoneStep; error: string };

export function errorMessage(e: unknown): string {
	if (e instanceof Error && e.message) return e.message;
	if (typeof e === 'string' && e) return e;
	return 'Unknown error';
}

/** Posts the "before the timer" comment. Throws if the session has no baseline. */
export async function postBaselineComment(
	taskId: string,
	session: Session,
	deps: Pick<DoneDeps, 'postComment' | 'timeZone'>
): Promise<void> {
	const startedAt = sessionStart(session);
	if (!session.baseline || startedAt === null) throw new Error('No baseline to post');
	await deps.postComment(taskId, formatBaselineComment(session.baseline, startedAt, deps.timeZone));
}

/**
 * Runs the remaining Done steps for a session already in `done` status:
 * post any pending baseline comment, post the session comment, then
 * overwrite the task's duration. Steps that already succeeded are skipped,
 * so retries never post a second comment.
 */
export async function runDoneFlow(
	taskId: string,
	session: Session,
	deps: DoneDeps
): Promise<DoneResult> {
	let current = session;

	// Normally posted at Start; if that failed, it still goes first.
	if (needsBaselineComment(current)) {
		try {
			await postBaselineComment(taskId, current, deps);
		} catch (e) {
			return { ok: false, session: current, step: 'baseline', error: errorMessage(e) };
		}
		current = markBaselinePosted(current);
		deps.onProgress(current);
	}

	if (!current.commentPosted) {
		try {
			await deps.postComment(taskId, formatSessionComment(current, deps.timeZone));
		} catch (e) {
			return { ok: false, session: current, step: 'comment', error: errorMessage(e) };
		}
		current = markCommentPosted(current);
		deps.onProgress(current);
	}

	if (!current.durationSaved) {
		try {
			await deps.saveDuration(taskId, durationMinutes(current.accumulatedMs));
		} catch (e) {
			return { ok: false, session: current, step: 'duration', error: errorMessage(e) };
		}
		current = markDurationSaved(current);
		deps.onProgress(current);
	}

	return isDoneComplete(current)
		? { ok: true, session: current }
		: { ok: false, session: current, step: 'duration', error: 'Done flow did not complete' };
}
