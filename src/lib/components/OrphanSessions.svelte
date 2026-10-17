<script lang="ts">
	import { timers } from '#lib/app-state.svelte.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { durationMinutes, formatMinutes } from '#lib/timer.js';

	let { activeIds }: { activeIds: ReadonlySet<string> } = $props();

	const orphans = $derived(timers.orphans(activeIds));
</script>

{#if orphans.length > 0}
	<Alert.Root>
		<Alert.Title>Tracked time on tasks that are no longer active</Alert.Title>
		<Alert.Description>
			<p>These tasks were completed or deleted in Todoist. Note the time before dismissing.</p>
			<ul class="mt-2 flex w-full flex-col gap-1">
				{#each orphans as [id, session] (id)}
					<li class="flex items-center justify-between gap-3">
						<span class="min-w-0 truncate">
							{session.taskContent || `Task ${id}`} —
							<span class="font-medium text-foreground">
								{formatMinutes(durationMinutes(timers.elapsed(id)))}
							</span>
							{#if session.status === 'running'}(still running){/if}
						</span>
						<Button
							size="sm"
							variant="outline"
							class="h-9 shrink-0"
							onclick={() => timers.discard(id)}
						>
							Dismiss
						</Button>
					</li>
				{/each}
			</ul>
		</Alert.Description>
	</Alert.Root>
{/if}
