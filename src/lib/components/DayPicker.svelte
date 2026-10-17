<script lang="ts">
	import { parseDate, type DateValue } from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Calendar from '#lib/components/ui/calendar/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { addDays } from '#lib/day-view.js';

	let {
		selected = $bindable(),
		today,
		counts
	}: {
		/** Selected day, `YYYY-MM-DD`. */
		selected: string;
		today: string;
		/** Tasks due per day, to mark days in the calendar. */
		counts: ReadonlyMap<string, number>;
	} = $props();

	let open = $state(false);

	const locale = typeof navigator === 'undefined' ? 'en-GB' : navigator.language;
	const labelFmt = new Intl.DateTimeFormat(locale, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});

	const label = $derived.by(() => {
		if (selected === today) return 'Today';
		if (selected === addDays(today, 1)) return 'Tomorrow';
		if (selected === addDays(today, -1)) return 'Yesterday';
		const [y, m, d] = selected.split('-').map(Number);
		return labelFmt.format(new Date(Date.UTC(y, m - 1, d)));
	});

	function pick(value: DateValue | undefined) {
		if (!value) return;
		selected = value.toString();
		open = false;
	}
</script>

<div class="flex items-center gap-1">
	<Button
		size="icon-sm"
		variant="outline"
		class="size-10 sm:size-8"
		aria-label="Previous day"
		onclick={() => (selected = addDays(selected, -1))}
	>
		<ChevronLeftIcon />
	</Button>

	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					size="sm"
					class="h-10 min-w-0 flex-1 justify-start sm:h-8 sm:w-40 sm:flex-none"
				>
					<CalendarIcon />
					<span class="truncate">{label}</span>
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-auto p-0" align="start">
			<Calendar.Calendar
				type="single"
				value={parseDate(selected)}
				onValueChange={pick}
				{locale}
				class="rounded-md"
			>
				{#snippet day({ day: date })}
					{@const count = counts.get(date.toString()) ?? 0}
					<Calendar.Day>
						{#snippet children({ day: dayNumber })}
							{dayNumber}
							{#if count > 0}
								<span
									class="size-1 rounded-full bg-current opacity-60"
									aria-label="{count} tasks due"
								></span>
							{/if}
						{/snippet}
					</Calendar.Day>
				{/snippet}
			</Calendar.Calendar>
		</Popover.Content>
	</Popover.Root>

	<Button
		size="icon-sm"
		variant="outline"
		class="size-10 sm:size-8"
		aria-label="Next day"
		onclick={() => (selected = addDays(selected, 1))}
	>
		<ChevronRightIcon />
	</Button>

	{#if selected !== today}
		<Button size="sm" variant="ghost" class="h-10 sm:h-8" onclick={() => (selected = today)}>
			Today
		</Button>
	{/if}
</div>
