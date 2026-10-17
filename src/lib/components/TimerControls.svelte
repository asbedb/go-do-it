<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { timers as appTimers } from '#lib/app-state.svelte.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { formatDueLabel } from '#lib/day-view.js';
	import { durationMinutes, formatMinutes, formatTaskDuration, makeBaseline } from '#lib/timer.js';
	import type { Timers } from '#lib/timers.svelte.js';
	import type { TaskSummary } from '#lib/todoist.js';

	let {
		taskId,
		content,
		due = null,
		todoistDuration = null,
		timers = appTimers
	}: {
		taskId: string;
		content: string;
		due?: TaskSummary['due'];
		/** The duration currently in Todoist, which Done will overwrite. */
		todoistDuration?: TaskSummary['duration'];
		timers?: Timers;
	} = $props();

	async function startTimer() {
		const baseline = makeBaseline(formatDueLabel(due), todoistDuration);
		const posting = timers.start(taskId, content, baseline);
		if (!posting) return;
		const outcome = await posting;
		if (outcome.ok) {
			toast(`Noted the date and duration “${content}” had before the timer`);
		} else {
			toast.error('Could not log the date and duration from before the timer', {
				description: `${outcome.error}. It will be posted again when you click Done.`
			});
		}
	}

	const session = $derived(timers.get(taskId));
	const busy = $derived(Boolean(timers.inFlight[taskId]));
	let discardOpen = $state(false);
	let doneOpen = $state(false);

	// Live while the dialog is open, so a running timer's numbers keep up.
	const preview = $derived(doneOpen ? timers.preview(taskId) : null);

	// Full-width, finger-sized buttons on phones; compact from `sm` up.
	const action = 'h-10 flex-1 sm:h-8 sm:flex-none';

	async function done() {
		doneOpen = false;
		const outcome = await timers.done(taskId);
		if (outcome.ok) {
			toast.success(`Logged time on “${content}”`);
		} else if (outcome.step === 'baseline') {
			toast.error('Could not log the date and duration from before the timer', {
				description: outcome.error
			});
		} else if (outcome.step === 'comment') {
			toast.error('Could not post the session comment', { description: outcome.error });
		} else {
			toast.error('Comment posted, but the duration was not saved', {
				description: outcome.error
			});
		}
	}

	function discard() {
		timers.discard(taskId);
		discardOpen = false;
		toast(`Discarded the session on “${content}”`);
	}
</script>

<div class="flex items-center gap-2">
	{#if session.status === 'idle'}
		<Button size="sm" class={action} onclick={startTimer}>
			<PlayIcon /> Start
		</Button>
	{:else if session.status === 'running'}
		<Button size="sm" class={action} variant="secondary" onclick={() => timers.pause(taskId)}>
			<PauseIcon /> Pause
		</Button>
	{:else if session.status === 'paused'}
		<Button size="sm" class={action} variant="secondary" onclick={() => timers.resume(taskId)}>
			<PlayIcon /> Resume
		</Button>
	{/if}

	{#if (session.status === 'paused' || session.status === 'done') && !busy}
		<Dialog.Root bind:open={discardOpen}>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						size="icon-sm"
						variant="ghost"
						class="size-10 shrink-0 sm:size-8"
						aria-label="Discard session"
					>
						<Trash2Icon />
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>Discard this session?</Dialog.Title>
					<Dialog.Description>
						{formatMinutes(durationMinutes(session.accumulatedMs))} tracked on “{content}” will be
						thrown away{session.commentPosted ? ' (its comment is already in Todoist)' : ''}. This
						can't be undone.
					</Dialog.Description>
				</Dialog.Header>
				<Dialog.Footer>
					<Dialog.Close>
						{#snippet child({ props })}
							<Button {...props} variant="outline" class="h-10 sm:h-9">Keep it</Button>
						{/snippet}
					</Dialog.Close>
					<Button variant="destructive" class="h-10 sm:h-9" onclick={discard}>Discard</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}

	<!-- Done sits on the right of the task box. -->
	{#if session.status === 'running' || session.status === 'paused'}
		<Dialog.Root bind:open={doneOpen}>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button {...props} size="sm" class="{action} sm:ml-auto">
						<CheckIcon /> Done
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content class="max-h-[90dvh] overflow-y-auto">
				{#if preview}
					<Dialog.Header>
						<Dialog.Title>Log {formatMinutes(preview.minutes)} on “{content}”?</Dialog.Title>
						<Dialog.Description>
							The timer stops, a session comment is posted, and the task stays open.
						</Dialog.Description>
					</Dialog.Header>
					<Alert.Root>
						<TriangleAlertIcon />
						<Alert.Title>This overwrites the time in Todoist</Alert.Title>
						<Alert.Description>
							{#if todoistDuration}
								The task's duration ({formatTaskDuration(todoistDuration)}) will be replaced with
								{formatMinutes(preview.minutes)}. It is not added to.
							{:else}
								The task's duration will be set to {formatMinutes(preview.minutes)}.
							{/if}
						</Alert.Description>
					</Alert.Root>
					<div class="flex min-w-0 flex-col gap-1.5 text-sm">
						<p class="text-muted-foreground">Comment to post:</p>
						<pre
							class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{preview.comment}</pre>
					</div>
					<Dialog.Footer>
						<Dialog.Close>
							{#snippet child({ props })}
								<Button {...props} variant="outline" class="h-10 sm:h-9">Cancel</Button>
							{/snippet}
						</Dialog.Close>
						<Button class="h-10 sm:h-9" onclick={done}>
							<CheckIcon /> Log time
						</Button>
					</Dialog.Footer>
				{/if}
			</Dialog.Content>
		</Dialog.Root>
	{:else if session.status === 'done'}
		{#if busy}
			<Button size="sm" class="{action} sm:ml-auto" disabled>
				<Loader2Icon class="animate-spin" /> Saving…
			</Button>
		{:else}
			<!-- Already confirmed when Done was first clicked. -->
			<Button size="sm" class="{action} sm:ml-auto" onclick={done}>
				<RotateCwIcon /> Retry
			</Button>
		{/if}
	{/if}
</div>
