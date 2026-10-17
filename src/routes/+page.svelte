<script lang="ts">
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { onMount } from 'svelte';
	import { ApiError, getConfig, getTasks, setUserToken } from '#lib/api.js';
	import { loadUserToken, saveUserToken, timers } from '#lib/app-state.svelte.js';
	import ModeToggle from '#lib/components/ModeToggle.svelte';
	import OrphanSessions from '#lib/components/OrphanSessions.svelte';
	import SampleTimer from '#lib/components/SampleTimer.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import TokenForm from '#lib/components/TokenForm.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import type { TaskSummary } from '#lib/todoist.js';

	// Restore saved sessions before the first render.
	timers.restore();

	type Phase = 'loading' | 'needs-token' | 'ready' | 'error';

	let phase = $state<Phase>('loading');
	let tasks = $state<TaskSummary[]>([]);
	let loadError = $state<string | null>(null);
	let tokenError = $state<string | null>(null);
	let refreshing = $state(false);
	let serverToken = $state(false);

	const activeIds = $derived(new Set(tasks.map((t) => t.id)));

	async function loadTasks() {
		refreshing = true;
		try {
			tasks = await getTasks();
			loadError = null;
			tokenError = null;
			phase = 'ready';
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Could not load tasks';
			if (e instanceof ApiError && e.status === 401 && !serverToken) {
				saveUserToken(null);
				tokenError = `Todoist rejected that token: ${message}`;
				phase = 'needs-token';
			} else {
				loadError = message;
				if (phase !== 'ready') phase = 'error';
			}
		} finally {
			refreshing = false;
		}
	}

	async function init() {
		phase = 'loading';
		try {
			serverToken = (await getConfig()).serverToken;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Could not reach the app server';
			phase = 'error';
			return;
		}
		if (!serverToken) {
			const saved = loadUserToken();
			if (!saved) {
				phase = 'needs-token';
				return;
			}
			setUserToken(saved);
		}
		await loadTasks();
	}

	function connect(token: string) {
		saveUserToken(token);
		phase = 'loading';
		loadTasks();
	}

	function forgetToken() {
		saveUserToken(null);
		tasks = [];
		phase = 'needs-token';
	}

	onMount(() => {
		init();
		return () => timers.destroy();
	});
</script>

<svelte:head>
	<title>{timers.runningCount > 0 ? `(${timers.runningCount}) ` : ''}Go do it now</title>
</svelte:head>

<header
	class="sticky top-0 z-10 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-backdrop-filter:bg-background/80"
>
	<div class="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-4 py-3">
		<div class="flex flex-col">
			<h1 class="flex min-w-0 items-center gap-2 text-lg font-semibold sm:text-xl">
				<TimerIcon class="size-5 shrink-0" />
				<span class="truncate">do it now</span>
			</h1>
			<span class="ml-4 text-xs italic">a todoist task timer</span>
		</div>
		<div class="flex shrink-0 items-center gap-1 sm:gap-2">
			<Badge
				variant={timers.runningCount > 0 ? 'default' : 'outline'}
				aria-live="polite"
				class="tabular-nums"
			>
				{timers.runningCount}
				<span class="hidden sm:inline">{timers.runningCount === 1 ? 'timer' : 'timers'}</span>
				running
			</Badge>
			<ModeToggle />
			{#if phase === 'ready'}
				<Button
					size="icon-sm"
					variant="ghost"
					class="size-10 sm:size-8"
					onclick={loadTasks}
					disabled={refreshing}
					aria-label="Refresh tasks"
				>
					<RefreshCwIcon class={refreshing ? 'animate-spin' : ''} />
				</Button>
				{#if !serverToken}
					<Button
						size="icon-sm"
						variant="ghost"
						class="size-10 sm:hidden"
						onclick={forgetToken}
						aria-label="Forget token"
					>
						<LogOutIcon />
					</Button>
					<Button size="sm" variant="ghost" class="hidden sm:inline-flex" onclick={forgetToken}>
						Forget token
					</Button>
				{/if}
			{/if}
		</div>
	</div>
</header>

<main
	class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pt-6"
>
	{#if timers.storageWarning}
		<Alert.Root>
			<Alert.Title>Timers may not be saved</Alert.Title>
			<Alert.Description>{timers.storageWarning}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if phase === 'loading'}
		<div class="flex flex-col gap-2" aria-busy="true" aria-label="Loading tasks">
			{#each { length: 6 }, i (i)}
				<Skeleton class="h-24 w-full rounded-lg" />
			{/each}
		</div>
	{:else if phase === 'needs-token'}
		<SampleTimer />
		<TokenForm onsubmit={connect} error={tokenError} />
	{:else if phase === 'error'}
		<Alert.Root variant="destructive">
			<Alert.Title>Could not load your Todoist tasks</Alert.Title>
			<Alert.Description>
				<p>{loadError}</p>
				<Button class="mt-2 h-10 sm:h-8" size="sm" variant="outline" onclick={init}
					>Try again</Button
				>
			</Alert.Description>
		</Alert.Root>
	{:else}
		{#if loadError}
			<Alert.Root variant="destructive">
				<Alert.Title>Refresh failed</Alert.Title>
				<Alert.Description>{loadError}</Alert.Description>
			</Alert.Root>
		{/if}
		<OrphanSessions {activeIds} />
		<TaskList {tasks} />
	{/if}
</main>
