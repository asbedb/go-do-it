<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import HashIcon from '@lucide/svelte/icons/hash';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import Rows3Icon from '@lucide/svelte/icons/rows-3';
	import XIcon from '@lucide/svelte/icons/x';
	import { timers as appTimers } from '#lib/app-state.svelte.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';
	import { formatClock, formatMinutes, formatTaskDuration } from '#lib/timer.js';
	import type { DoneStep } from '#lib/done-flow.js';
	import type { Timers } from '#lib/timers.svelte.js';
	import type { TaskSummary } from '#lib/todoist.js';
	import TimerControls from './TimerControls.svelte';

	let {
		task,
		timers = appTimers,
		overdue = false,
		class: className
	}: { task: TaskSummary; timers?: Timers; overdue?: boolean; class?: string } = $props();

	const session = $derived(timers.get(task.id));
	const busy = $derived(Boolean(timers.inFlight[task.id]));
	const elapsed = $derived(timers.elapsed(task.id));
	const logged = $derived(timers.lastLogged[task.id]);

	// A `done` session that isn't in flight has a step left to retry, either from
	// a failure this visit or from a Done interrupted before the browser closed.
	const failure = $derived.by(() => {
		if (session.status !== 'done' || busy) return null;
		const known = timers.failures[task.id];
		if (known) return known;
		const step: DoneStep =
			session.baseline && !session.baselinePosted
				? 'baseline'
				: session.commentPosted
					? 'duration'
					: 'comment';
		return {
			step,
			error: 'Done did not finish last time. Retry to complete it.'
		};
	});

	// After a Done this visit, Todoist holds the new value even before a refresh.
	const todoistDuration = $derived<TaskSummary['duration']>(
		logged ? { amount: logged.minutes, unit: 'minute' } : task.duration
	);

	const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
</script>

<li
	class={cn(
		'flex list-none flex-col gap-3 rounded-lg border bg-card p-3 transition-colors sm:p-4',
		session.status === 'running' && 'border-primary bg-accent ring-1 ring-primary',
		failure && 'border-destructive',
		className
	)}
>
	<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
		<div class="min-w-0 flex-1">
			{#if task.url}
				<!-- External Todoist link, not an app route. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={task.url}
					target="_blank"
					rel="noreferrer"
					class="group inline-flex items-start gap-1 font-medium break-words hover:underline"
				>
					<span class="min-w-0 break-words">{task.content}</span>
					<ExternalLinkIcon
						class="mt-1 size-3 shrink-0 opacity-50 transition-opacity sm:opacity-0 sm:group-hover:opacity-60"
					/>
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{:else}
				<span class="font-medium break-words">{task.content}</span>
			{/if}

			<ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
				{#if task.projectName}
					<!-- The project's own Todoist colour is data, so it can't be a static class. -->
					<li
						class="inline-flex items-center gap-1"
						title="Project"
						style:--project-color={task.projectColor}
					>
						<HashIcon
							class={cn('size-3', task.projectColor && 'text-(--project-color)')}
							strokeWidth={2.5}
						/>
						<span
							class={cn(
								'border-b-2 pb-px',
								task.projectColor ? 'border-(--project-color)' : 'border-transparent'
							)}
						>
							{task.projectName}
						</span>
					</li>
				{/if}
				{#if task.sectionName}
					<li class="inline-flex items-center gap-1" title="Section">
						<Rows3Icon class="size-3" />{task.sectionName}
					</li>
				{/if}
				{#if task.due}
					<li
						class={cn('inline-flex items-center gap-1', overdue && 'text-destructive')}
						title="Due"
					>
						<CalendarIcon class="size-3" />{task.due.string}
					</li>
				{/if}
				<li class="inline-flex items-center gap-1" title="Duration currently in Todoist">
					<ClockIcon class="size-3" />
					{todoistDuration ? `${formatTaskDuration(todoistDuration)} in Todoist` : 'No time set'}
				</li>
			</ul>
		</div>

		{#if session.status !== 'idle'}
			<div class="flex items-center justify-between gap-2 sm:justify-end">
				<span
					class="order-first font-mono text-2xl tabular-nums sm:order-last sm:text-lg"
					aria-label="Elapsed time"
				>
					{formatClock(elapsed)}
				</span>
				{#if session.status === 'running'}
					<Badge class="gap-1.5">
						<span class="size-1.5 animate-pulse rounded-full bg-primary-foreground"></span>
						Running
					</Badge>
				{:else if session.status === 'paused'}
					<Badge variant="secondary">Paused</Badge>
				{:else}
					<Badge variant={failure ? 'destructive' : 'outline'}>
						{failure ? 'Needs retry' : 'Saving'}
					</Badge>
				{/if}
			</div>
		{/if}
	</div>

	<TimerControls
		taskId={task.id}
		content={task.content}
		due={task.due}
		{todoistDuration}
		{timers}
	/>

	{#if session.status !== 'idle' && session.baseline}
		<p class="flex items-start gap-1.5 text-xs text-muted-foreground">
			<HistoryIcon class="mt-0.5 size-3 shrink-0" />
			<span>
				Before the timer: due {session.baseline.due ?? 'none'} · duration
				{session.baseline.duration ? formatTaskDuration(session.baseline.duration) : 'none'}
				{session.baselinePosted ? '(logged as a comment)' : '(comment pending)'}
			</span>
		</p>
	{/if}

	{#if failure}
		<Alert.Root variant="destructive">
			<Alert.Title>
				{#if failure.step === 'baseline'}
					Earlier date and duration not logged
				{:else if failure.step === 'comment'}
					Session comment not posted
				{:else}
					Comment posted · duration not saved
				{/if}
			</Alert.Title>
			<Alert.Description class="break-words">{failure.error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if logged}
		<div class="flex min-w-0 flex-col gap-1.5 border-t pt-3 text-sm">
			<div class="flex items-center justify-between gap-2">
				<p class="text-muted-foreground">
					Logged {formatMinutes(logged.minutes)} at {timeFmt.format(logged.at)}. Comment posted:
				</p>
				<Button
					size="icon-sm"
					variant="ghost"
					class="size-8 shrink-0"
					aria-label="Hide logged comment"
					onclick={() => timers.dismissLogged(task.id)}
				>
					<XIcon />
				</Button>
			</div>
			<pre
				class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{logged.comment}</pre>
		</div>
	{/if}
</li>
