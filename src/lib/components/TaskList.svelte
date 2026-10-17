<script lang="ts">
	import { timers } from '#lib/app-state.svelte.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { countByDay, dayKey, dueDayKey, groupForDay } from '#lib/day-view.js';
	import type { TaskSummary } from '#lib/todoist.js';
	import DayPicker from './DayPicker.svelte';
	import TaskRow from './TaskRow.svelte';

	let { tasks }: { tasks: TaskSummary[] } = $props();

	let view = $state<'day' | 'all'>('day');
	let query = $state('');
	let today = $state(dayKey(Date.now()));
	let selected = $state(dayKey(Date.now()));

	// Roll "today" over at midnight; follow along if the user was on today.
	$effect(() => {
		const id = setInterval(() => {
			const now = dayKey(Date.now());
			if (now === today) return;
			if (selected === today) selected = now;
			today = now;
		}, 60_000);
		return () => clearInterval(id);
	});

	const matching = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return tasks;
		return tasks.filter((t) =>
			[t.content, t.projectName, t.sectionName].some((s) => s?.toLowerCase().includes(q))
		);
	});

	const hasSession = (t: TaskSummary) => (timers.sessions[t.id]?.status ?? 'idle') !== 'idle';

	const counts = $derived(countByDay(tasks));
	const groups = $derived(groupForDay(matching, selected, today));

	// Timers on tasks not due that day stay visible, so none is forgotten.
	const inProgress = $derived(
		matching.filter((t) => hasSession(t) && !groups.day.includes(t) && !groups.overdue.includes(t))
	);

	// All tasks: sessions first, then by due date (undated last), then Todoist order.
	const all = $derived(
		[...matching].sort((a, b) => {
			const sa = hasSession(a) ? 0 : 1;
			const sb = hasSession(b) ? 0 : 1;
			if (sa !== sb) return sa - sb;
			const da = dueDayKey(a.due) ?? '9999';
			const db = dueDayKey(b.due) ?? '9999';
			if (da !== db) return da < db ? -1 : 1;
			return a.order - b.order;
		})
	);

	const dayEmpty = $derived(
		groups.day.length === 0 && groups.overdue.length === 0 && inProgress.length === 0
	);
</script>

{#snippet group(title: string, list: TaskSummary[], overdue = false)}
	{#if list.length > 0}
		<section class="flex flex-col gap-2">
			<h2 class="flex items-baseline gap-2 text-sm font-semibold">
				<span class={overdue ? 'text-destructive' : ''}>{title}</span>
				<span class="font-normal text-muted-foreground">{list.length}</span>
			</h2>
			<ul class="flex flex-col gap-2">
				{#each list as task (task.id)}
					<TaskRow {task} {overdue} />
				{/each}
			</ul>
		</section>
	{/if}
{/snippet}

<Tabs.Root bind:value={view} class="flex flex-col gap-3">
	<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<Tabs.List class="w-full sm:w-auto">
			<Tabs.Trigger value="day" class="flex-1 sm:flex-none">Day</Tabs.Trigger>
			<Tabs.Trigger value="all" class="flex-1 sm:flex-none">All tasks</Tabs.Trigger>
		</Tabs.List>
		{#if view === 'day'}
			<DayPicker bind:selected {today} {counts} />
		{/if}
	</div>

	<Input
		type="search"
		class="h-10 sm:h-9"
		placeholder="Filter by task, project or section…"
		bind:value={query}
		aria-label="Filter tasks"
	/>

	<Tabs.Content value="day" class="flex flex-col gap-5">
		{@render group('In progress', inProgress)}
		{@render group('Overdue', groups.overdue, true)}
		{@render group(selected === today ? 'Today' : 'Due this day', groups.day)}
		{#if dayEmpty}
			<p class="py-8 text-center text-sm text-muted-foreground">
				{query.trim() ? 'No tasks match that filter on this day.' : 'Nothing due on this day.'}
			</p>
		{/if}
	</Tabs.Content>

	<Tabs.Content value="all">
		{#if all.length === 0}
			<p class="py-8 text-center text-sm text-muted-foreground">
				{tasks.length === 0 ? 'No active tasks in Todoist.' : 'No tasks match that filter.'}
			</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each all as task (task.id)}
					<TaskRow {task} overdue={(dueDayKey(task.due) ?? '9999') < today} />
				{/each}
			</ul>
		{/if}
	</Tabs.Content>
</Tabs.Root>
