import { describe, expect, it, vi } from 'vitest';
import { runDoneFlow, type DoneDeps } from './done-flow';
import { beginDone, createSession, pause, resume, start, type Session } from './timer';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 17, 9, 0);

function doneSession(): Session {
	let s = start(createSession('Task'), T0);
	s = pause(s, T0 + 30 * MIN);
	s = resume(s, T0 + 60 * MIN);
	return beginDone(s, T0 + 60 * MIN + 30_500); // 30m 30.5s -> 31 minutes
}

type Mocked<F extends (...args: never[]) => unknown> = ReturnType<typeof vi.fn<F>>;

interface MockDeps extends DoneDeps {
	postComment: Mocked<DoneDeps['postComment']>;
	saveDuration: Mocked<DoneDeps['saveDuration']>;
	onProgress: Mocked<DoneDeps['onProgress']>;
}

function deps(overrides: Partial<MockDeps> = {}): MockDeps {
	return {
		postComment: vi.fn<DoneDeps['postComment']>().mockResolvedValue(undefined),
		saveDuration: vi.fn<DoneDeps['saveDuration']>().mockResolvedValue(undefined),
		onProgress: vi.fn<DoneDeps['onProgress']>(),
		timeZone: 'UTC',
		...overrides
	};
}

describe('runDoneFlow', () => {
	it('posts exactly one comment, then sets the duration rounded up', async () => {
		const d = deps();
		const order: string[] = [];
		d.postComment.mockImplementation(async () => void order.push('comment'));
		d.saveDuration.mockImplementation(async () => void order.push('duration'));

		const result = await runDoneFlow('t1', doneSession(), d);

		expect(result.ok).toBe(true);
		expect(order).toEqual(['comment', 'duration']);
		expect(d.postComment).toHaveBeenCalledTimes(1);
		expect(d.postComment.mock.calls[0][0]).toBe('t1');
		expect(d.postComment.mock.calls[0][1]).toMatch(/^⏱ Session: 31m \(Sat 17 Oct 2026\)\n- /);
		expect(d.saveDuration).toHaveBeenCalledExactlyOnceWith('t1', 31);
	});

	it('sends the session total, not anything added to an existing duration', async () => {
		const d = deps();
		await runDoneFlow('t1', doneSession(), d);
		await runDoneFlow('t1', doneSession(), d);
		expect(d.saveDuration.mock.calls).toEqual([
			['t1', 31],
			['t1', 31]
		]);
	});

	it('persists progress after each step', async () => {
		const d = deps();
		await runDoneFlow('t1', doneSession(), d);
		expect(d.onProgress).toHaveBeenCalledTimes(2);
		expect(d.onProgress.mock.calls[0][0]).toMatchObject({
			commentPosted: true,
			durationSaved: false
		});
		expect(d.onProgress.mock.calls[1][0]).toMatchObject({
			commentPosted: true,
			durationSaved: true
		});
	});

	it('stops after a failed comment and keeps the time intact', async () => {
		const d = deps({ postComment: vi.fn().mockRejectedValue(new Error('Task not found')) });
		const session = doneSession();
		const result = await runDoneFlow('t1', session, d);

		expect(result).toMatchObject({ ok: false, step: 'comment', error: 'Task not found' });
		expect(result.session.accumulatedMs).toBe(session.accumulatedMs);
		expect(result.session.commentPosted).toBe(false);
		expect(d.saveDuration).not.toHaveBeenCalled();
		expect(d.onProgress).not.toHaveBeenCalled();
	});

	it('retrying after a failed duration never posts a second comment', async () => {
		const saveDuration = vi
			.fn<DoneDeps['saveDuration']>()
			.mockRejectedValueOnce(new Error('Task must have a due date'))
			.mockResolvedValueOnce(undefined);
		const d = deps({ saveDuration });

		const first = await runDoneFlow('t1', doneSession(), d);
		expect(first).toMatchObject({
			ok: false,
			step: 'duration',
			error: 'Task must have a due date'
		});
		expect(first.session.commentPosted).toBe(true);

		const second = await runDoneFlow('t1', first.session, d);
		expect(second.ok).toBe(true);
		expect(d.postComment).toHaveBeenCalledTimes(1);
		expect(saveDuration).toHaveBeenCalledTimes(2);
	});

	it('does nothing for steps that already succeeded', async () => {
		const d = deps();
		const finished = { ...doneSession(), commentPosted: true, durationSaved: true };
		const result = await runDoneFlow('t1', finished, d);
		expect(result.ok).toBe(true);
		expect(d.postComment).not.toHaveBeenCalled();
		expect(d.saveDuration).not.toHaveBeenCalled();
	});
});
