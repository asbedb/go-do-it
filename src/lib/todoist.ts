// All Todoist calls go through here. Functions take the SDK client as an
// argument so tests can pass a mock. Done never completes a task, so this
// module deliberately has no wrapper for closeTask.
import { getColorByKey, TodoistRequestError, type TodoistApi } from '@doist/todoist-sdk';

/** The subset of the SDK this app uses. */
export type TodoistClient = Pick<
	TodoistApi,
	'getTasks' | 'getProjects' | 'getSections' | 'addComment' | 'updateTask'
>;

/** What the UI needs about a task. */
export interface TaskSummary {
	id: string;
	content: string;
	projectId: string;
	/** Null if project names couldn't be loaded. */
	projectName: string | null;
	/** The project's Todoist colour as hex, e.g. `#b8255f`. */
	projectColor: string | null;
	sectionId: string | null;
	sectionName: string | null;
	url: string;
	/** Todoist priority: 4 is highest (p1), 1 is none. */
	priority: number;
	order: number;
	due: { date: string; datetime: string | null; string: string; isRecurring: boolean } | null;
	duration: { amount: number; unit: 'minute' | 'day' } | null;
}

const PAGE_LIMIT = 200;

/** Follows v1 cursor pagination to the end. */
async function fetchAll<T>(
	getPage: (cursor: string | null) => Promise<{ results: T[]; nextCursor: string | null }>
): Promise<T[]> {
	const all: T[] = [];
	let cursor: string | null = null;
	do {
		const page = await getPage(cursor);
		all.push(...page.results);
		cursor = page.nextCursor;
	} while (cursor);
	return all;
}

async function byId<T extends { id: string }>(
	load: () => Promise<T[]>
): Promise<Map<string, T> | null> {
	try {
		return new Map((await load()).map((x) => [x.id, x]));
	} catch {
		// Names are only informational; the task list still works without them.
		return null;
	}
}

/** Every active task, with its project and section names resolved. */
export async function fetchActiveTasks(api: TodoistClient): Promise<TaskSummary[]> {
	const [tasks, projects, sections] = await Promise.all([
		fetchAll((cursor) => api.getTasks({ cursor, limit: PAGE_LIMIT })),
		byId(() => fetchAll((cursor) => api.getProjects({ cursor, limit: PAGE_LIMIT }))),
		byId(() => fetchAll((cursor) => api.getSections({ cursor, limit: PAGE_LIMIT })))
	]);

	return tasks
		.filter((t) => !t.checked && !t.isDeleted)
		.map((t) => {
			const project = projects?.get(t.projectId);
			return {
				id: t.id,
				content: t.content,
				projectId: t.projectId,
				projectName: project?.name ?? null,
				projectColor: project ? getColorByKey(project.color).hexValue : null,
				sectionId: t.sectionId,
				sectionName: t.sectionId ? (sections?.get(t.sectionId)?.name ?? null) : null,
				url: t.url,
				priority: t.priority,
				order: t.childOrder,
				due: t.due
					? {
							date: t.due.date,
							datetime: t.due.datetime ?? null,
							string: t.due.string,
							isRecurring: t.due.isRecurring
						}
					: null,
				duration: t.duration ? { amount: t.duration.amount, unit: t.duration.unit } : null
			};
		});
}

export async function postSessionComment(
	api: TodoistClient,
	taskId: string,
	content: string
): Promise<void> {
	if (!content.trim()) throw new Error('Comment content is empty');
	await api.addComment({ taskId, content });
}

/** Replaces (never adds to) the task's duration, in whole minutes. */
export async function saveTaskDuration(
	api: TodoistClient,
	taskId: string,
	minutes: number
): Promise<void> {
	if (!Number.isInteger(minutes) || minutes < 1) {
		throw new Error(`Duration must be a positive whole number of minutes, got ${minutes}`);
	}
	await api.updateTask(taskId, { duration: minutes, durationUnit: 'minute' });
}

/** A readable message from an SDK error, preferring what the API said. */
export function todoistErrorMessage(e: unknown): string {
	if (e instanceof TodoistRequestError) {
		const detail = extractApiDetail(e.responseData);
		const status = e.httpStatusCode ? ` (HTTP ${e.httpStatusCode})` : '';
		return `${detail ?? e.message}${status}`;
	}
	if (e instanceof Error && e.message) return e.message;
	return 'Unknown Todoist error';
}

function extractApiDetail(data: unknown): string | null {
	if (typeof data === 'string' && data.trim()) return data.trim();
	if (typeof data === 'object' && data !== null) {
		const d = data as Record<string, unknown>;
		for (const key of ['error', 'message', 'detail', 'error_tag']) {
			if (typeof d[key] === 'string' && d[key]) return d[key] as string;
		}
	}
	return null;
}

export function todoistErrorStatus(e: unknown): number {
	if (e instanceof TodoistRequestError && e.httpStatusCode) {
		return e.httpStatusCode >= 400 && e.httpStatusCode < 600 ? e.httpStatusCode : 502;
	}
	return 502;
}
