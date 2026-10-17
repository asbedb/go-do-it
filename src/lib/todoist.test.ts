import { TodoistRequestError, type Task } from '@doist/todoist-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
	fetchActiveTasks,
	postSessionComment,
	saveTaskDuration,
	todoistErrorMessage,
	todoistErrorStatus,
	type TodoistClient
} from './todoist';

function task(id: string, extra: Partial<Task> = {}): Task {
	return {
		id,
		content: `Task ${id}`,
		projectId: 'p1',
		sectionId: null,
		url: `https://app.todoist.com/app/task/${id}`,
		priority: 1,
		childOrder: 0,
		checked: false,
		isDeleted: false,
		due: null,
		duration: null,
		...extra
	} as Task;
}

const onePage = <T>(results: T[]) => ({ results, nextCursor: null });

function mockClient() {
	const api = {
		getTasks: vi.fn(),
		getProjects: vi.fn().mockResolvedValue(
			onePage([
				{ id: 'p1', name: 'Inbox', color: 'charcoal' },
				{ id: 'p2', name: 'Work', color: 'berry_red' }
			])
		),
		getSections: vi.fn().mockResolvedValue(onePage([{ id: 's1', name: 'Next up' }])),
		addComment: vi.fn().mockResolvedValue({}),
		updateTask: vi.fn().mockResolvedValue({}),
		closeTask: vi.fn()
	};
	return { api, client: api as unknown as TodoistClient };
}

describe('fetchActiveTasks', () => {
	it('follows cursors until there are no more pages', async () => {
		const { api, client } = mockClient();
		api.getTasks
			.mockResolvedValueOnce({ results: [task('1'), task('2')], nextCursor: 'c1' })
			.mockResolvedValueOnce({ results: [task('3')], nextCursor: 'c2' })
			.mockResolvedValueOnce({ results: [], nextCursor: null });

		const tasks = await fetchActiveTasks(client);

		expect(tasks.map((t) => t.id)).toEqual(['1', '2', '3']);
		expect(api.getTasks.mock.calls.map(([args]) => args.cursor)).toEqual([null, 'c1', 'c2']);
	});

	it('skips completed or deleted tasks and maps fields', async () => {
		const { api, client } = mockClient();
		api.getTasks.mockResolvedValueOnce({
			results: [
				task('1', {
					projectId: 'p2',
					sectionId: 's1',
					priority: 4,
					childOrder: 3,
					due: { date: '2026-10-17', string: 'today', isRecurring: false },
					duration: { amount: 30, unit: 'minute' }
				}),
				task('2', { checked: true }),
				task('3', { isDeleted: true })
			],
			nextCursor: null
		});

		const tasks = await fetchActiveTasks(client);
		expect(tasks).toEqual([
			{
				id: '1',
				content: 'Task 1',
				projectId: 'p2',
				projectName: 'Work',
				projectColor: '#b8255f',
				sectionId: 's1',
				sectionName: 'Next up',
				url: 'https://app.todoist.com/app/task/1',
				priority: 4,
				order: 3,
				due: { date: '2026-10-17', datetime: null, string: 'today', isRecurring: false },
				duration: { amount: 30, unit: 'minute' }
			}
		]);
	});

	it('pages through projects and sections too', async () => {
		const { api, client } = mockClient();
		api.getTasks.mockResolvedValueOnce(onePage([task('1', { projectId: 'p9' })]));
		api.getProjects
			.mockReset()
			.mockResolvedValueOnce({
				results: [{ id: 'p1', name: 'Inbox', color: 'charcoal' }],
				nextCursor: 'n'
			})
			.mockResolvedValueOnce(onePage([{ id: 'p9', name: 'Later', color: 'not_a_real_colour' }]));

		const [t] = await fetchActiveTasks(client);
		expect(t.projectName).toBe('Later');
		// Unknown colour keys fall back to Todoist's default (charcoal).
		expect(t.projectColor).toBe('#808080');
		expect(api.getProjects).toHaveBeenCalledTimes(2);
	});

	it('still returns tasks if project or section names fail to load', async () => {
		const { api, client } = mockClient();
		api.getTasks.mockResolvedValueOnce(onePage([task('1', { sectionId: 's1' })]));
		api.getProjects.mockRejectedValueOnce(new Error('nope'));
		api.getSections.mockRejectedValueOnce(new Error('nope'));

		const [t] = await fetchActiveTasks(client);
		expect(t).toMatchObject({ id: '1', projectName: null, projectColor: null, sectionName: null });
	});
});

describe('postSessionComment', () => {
	it('adds a comment on the task', async () => {
		const { api, client } = mockClient();
		await postSessionComment(client, 't1', '⏱ Session: 5m');
		expect(api.addComment).toHaveBeenCalledExactlyOnceWith({
			taskId: 't1',
			content: '⏱ Session: 5m'
		});
		expect(api.closeTask).not.toHaveBeenCalled();
	});

	it('refuses empty content', async () => {
		const { api, client } = mockClient();
		await expect(postSessionComment(client, 't1', '  ')).rejects.toThrow();
		expect(api.addComment).not.toHaveBeenCalled();
	});
});

describe('saveTaskDuration', () => {
	it('sends duration and unit together, in minutes', async () => {
		const { api, client } = mockClient();
		await saveTaskDuration(client, 't1', 42);
		expect(api.updateTask).toHaveBeenCalledExactlyOnceWith('t1', {
			duration: 42,
			durationUnit: 'minute'
		});
		expect(api.closeTask).not.toHaveBeenCalled();
	});

	it.each([0, -1, 1.5, Number.NaN])('rejects %s minutes without calling the API', async (m) => {
		const { api, client } = mockClient();
		await expect(saveTaskDuration(client, 't1', m)).rejects.toThrow(/positive whole number/);
		expect(api.updateTask).not.toHaveBeenCalled();
	});
});

describe('error helpers', () => {
	it("prefers the API's own error message", () => {
		const e = new TodoistRequestError('Request failed', 400, {
			error: 'Duration requires a due date'
		});
		expect(todoistErrorMessage(e)).toBe('Duration requires a due date (HTTP 400)');
		expect(todoistErrorStatus(e)).toBe(400);
	});

	it('falls back to the SDK message and a 502 status', () => {
		const e = new TodoistRequestError('Network down');
		expect(todoistErrorMessage(e)).toBe('Network down');
		expect(todoistErrorStatus(e)).toBe(502);
		expect(todoistErrorMessage(new Error('boom'))).toBe('boom');
	});
});
