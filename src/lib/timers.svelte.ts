// Shared, reactive timer state. Components read from here instead of keeping
// their own copies of elapsed time. All timer math lives in ./timer.ts.
import {
	errorMessage,
	postBaselineComment,
	runDoneFlow,
	type DoneDeps,
	type DoneStep
} from './done-flow.js';
import { loadSessions, saveSessions } from './persistence.js';
import {
	beginDone,
	createSession,
	durationMinutes,
	elapsedMs,
	formatSessionComment,
	markBaselinePosted,
	pause,
	resume,
	runningCount,
	start,
	type Baseline,
	type Session,
	type SessionMap
} from './timer.js';

export interface DoneFailure {
	step: DoneStep;
	error: string;
}

export interface TimersOptions {
	now?: () => number;
	storage?: Storage | null;
	api: Pick<DoneDeps, 'postComment' | 'saveDuration'>;
	timeZone?: string;
	/** Display refresh interval; only runs while a timer is running. */
	tickMs?: number;
}

export type DoneOutcome = { ok: true } | ({ ok: false } & DoneFailure);

export type BaselineOutcome = { ok: true } | { ok: false; error: string };

export interface LoggedSession {
	comment: string;
	minutes: number;
	/** Epoch ms when Done finished. */
	at: number;
}

export class Timers {
	sessions = $state<SessionMap>({});
	/** Re-render clock; never the source of truth for elapsed time. */
	now = $state(0);
	failures = $state<Record<string, DoneFailure>>({});
	inFlight = $state<Record<string, true>>({});
	/** The last session logged per task this visit, for showing under the task. */
	lastLogged = $state<Record<string, LoggedSession>>({});
	storageWarning = $state<string | null>(null);

	readonly runningCount = $derived(runningCount(this.sessions));

	#clock: () => number;
	#storage: Storage | null;
	#api: TimersOptions['api'];
	#timeZone?: string;
	#tickMs: number;
	#ticker: ReturnType<typeof setInterval> | null = null;
	// Private bookkeeping, never rendered, so it needn't be reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#baselineInFlight = new Map<string, Promise<BaselineOutcome>>();

	constructor(options: TimersOptions) {
		this.#clock = options.now ?? Date.now;
		this.#storage = options.storage ?? null;
		this.#api = options.api;
		this.#timeZone = options.timeZone;
		this.#tickMs = options.tickMs ?? 500;
		this.now = this.#clock();
	}

	/** Restores saved sessions. Call before first render. */
	restore(): void {
		const result = loadSessions(this.#storage);
		this.sessions = result.sessions;
		this.storageWarning = result.ok ? null : result.message;
		this.#syncTicker();
	}

	get(taskId: string): Session {
		return this.sessions[taskId] ?? createSession();
	}

	elapsed(taskId: string): number {
		// Reading `now` subscribes running displays to the shared ticker.
		const now = Math.max(this.now, this.#clock());
		return elapsedMs(this.get(taskId), now);
	}

	/**
	 * Starts a fresh session. If the task already had a due date or duration,
	 * records it and posts a "before the timer" comment in the background; the
	 * returned promise reports how that went (null when there was nothing to log).
	 */
	start(
		taskId: string,
		taskContent: string,
		baseline: Baseline | null = null
	): Promise<BaselineOutcome> | null {
		const current = this.get(taskId);
		if (current.status !== 'idle') return null;
		this.#set(taskId, start({ ...current, taskContent, baseline }, this.#clock()));
		if (!baseline) return null;

		const posting = postBaselineComment(taskId, this.get(taskId), {
			postComment: this.#api.postComment,
			timeZone: this.#timeZone
		}).then(
			(): BaselineOutcome => {
				const latest = this.sessions[taskId];
				if (latest && latest.baseline && !latest.baselinePosted) {
					this.#set(taskId, markBaselinePosted(latest));
				}
				return { ok: true };
			},
			(e): BaselineOutcome => ({ ok: false, error: errorMessage(e) })
		);
		this.#baselineInFlight.set(taskId, posting);
		posting.finally(() => {
			if (this.#baselineInFlight.get(taskId) === posting) this.#baselineInFlight.delete(taskId);
		});
		return posting;
	}

	pause(taskId: string): void {
		this.#set(taskId, pause(this.get(taskId), this.#clock()));
	}

	resume(taskId: string): void {
		this.#set(taskId, resume(this.get(taskId), this.#clock()));
	}

	/** Pauses (if running), then posts the comment and saves the duration. */
	async done(taskId: string): Promise<DoneOutcome> {
		if (this.inFlight[taskId]) return { ok: false, step: 'comment', error: 'Already in progress' };
		const current = this.get(taskId);
		if (current.status === 'idle') return { ok: false, step: 'comment', error: 'Nothing tracked' };

		this.#set(taskId, beginDone(current, this.#clock()));
		this.inFlight[taskId] = true;
		delete this.failures[taskId];

		try {
			// Let a Start-time baseline post settle, so it's never sent twice.
			await this.#baselineInFlight.get(taskId);
			const result = await runDoneFlow(taskId, this.get(taskId), {
				postComment: this.#api.postComment,
				saveDuration: this.#api.saveDuration,
				onProgress: (s) => this.#set(taskId, s),
				timeZone: this.#timeZone
			});
			if (result.ok) {
				this.lastLogged[taskId] = {
					// Same text that was posted: the format is deterministic.
					comment: formatSessionComment(result.session, this.#timeZone),
					minutes: durationMinutes(result.session.accumulatedMs),
					at: this.#clock()
				};
				// Both steps succeeded: back to idle with a fresh, empty session.
				this.#remove(taskId);
				return { ok: true };
			}
			this.failures[taskId] = { step: result.step, error: result.error };
			return { ok: false, step: result.step, error: result.error };
		} finally {
			delete this.inFlight[taskId];
		}
	}

	/** What Done would post and save right now, without changing anything. */
	preview(taskId: string): { comment: string; minutes: number } {
		const frozen = beginDone(this.get(taskId), Math.max(this.now, this.#clock()));
		return {
			comment: formatSessionComment(frozen, this.#timeZone),
			minutes: durationMinutes(frozen.accumulatedMs)
		};
	}

	dismissLogged(taskId: string): void {
		delete this.lastLogged[taskId];
	}

	/** Explicit, user-confirmed removal of a session and its tracked time. */
	discard(taskId: string): void {
		this.#remove(taskId);
	}

	/** Sessions (with tracked time) whose task isn't in the active task list. */
	orphans(activeIds: ReadonlySet<string>): [string, Session][] {
		return Object.entries(this.sessions).filter(
			([id, s]) => !activeIds.has(id) && s.status !== 'idle'
		);
	}

	destroy(): void {
		if (this.#ticker) clearInterval(this.#ticker);
		this.#ticker = null;
	}

	#set(taskId: string, session: Session): void {
		this.sessions[taskId] = session;
		this.#persist();
	}

	#remove(taskId: string): void {
		delete this.sessions[taskId];
		delete this.failures[taskId];
		this.#persist();
	}

	#persist(): void {
		this.now = this.#clock();
		if (!saveSessions(this.#storage, $state.snapshot(this.sessions))) {
			this.storageWarning ??=
				'Timers could not be saved, so they will not survive closing the browser.';
		}
		this.#syncTicker();
	}

	/** One shared interval, alive only while at least one timer runs. */
	#syncTicker(): void {
		const anyRunning = runningCount(this.sessions) > 0;
		if (anyRunning && !this.#ticker) {
			this.#ticker = setInterval(() => (this.now = this.#clock()), this.#tickMs);
		} else if (!anyRunning && this.#ticker) {
			clearInterval(this.#ticker);
			this.#ticker = null;
		}
	}
}
