<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { dayKey } from '#lib/day-view.js';
	import { Timers } from '#lib/timers.svelte.js';
	import type { TaskSummary } from '#lib/todoist.js';
	import TaskRow from './TaskRow.svelte';

	// An offline timer for trying the controls: its own store, no storage, and
	// fake Todoist calls. The row shows the comment Done "posted", as real ones do.
	const task: TaskSummary = {
		id: 'sample',
		content: 'Sample task',
		projectId: 'sample',
		projectName: 'Sample project',
		projectColor: '#b8255f',
		sectionId: 'sample',
		sectionName: 'Sample section',
		// No URL: the sample isn't a real Todoist task, so its title isn't a link.
		url: '',
		priority: 1,
		order: 0,
		due: { date: dayKey(Date.now()), datetime: null, string: 'today', isRecurring: false },
		duration: { amount: 30, unit: 'minute' }
	};

	const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 600));

	const sample = new Timers({
		storage: null,
		api: { postComment: wait, saveDuration: wait }
	});

	$effect(() => () => sample.destroy());
</script>

<Card.Root class="mx-auto w-full max-w-md gap-4 py-4">
	<Card.Header class="px-4">
		<Card.Title>Sample timer</Card.Title>
		<Card.Description>
			Try the controls here. Nothing is sent to Todoist or saved in this browser.
		</Card.Description>
	</Card.Header>
	<Card.Content class="px-4">
		<ul>
			<TaskRow {task} timers={sample} />
		</ul>
	</Card.Content>
</Card.Root>
