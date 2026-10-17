<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';

	let { onsubmit, error }: { onsubmit: (token: string) => void; error?: string | null } = $props();

	let token = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (token.trim()) onsubmit(token.trim());
	}
</script>

<Card.Root class="mx-auto w-full max-w-md gap-4 py-4 sm:gap-6 sm:py-6">
	<Card.Header class="px-4 sm:px-6">
		<Card.Title>Connect to Todoist</Card.Title>
		<Card.Description>
			Set <code>TODOIST_API_TOKEN</code> in <code>.env</code> and restart the server, or paste your
			API token below. Find it in
			<a
				class="underline"
				href="https://app.todoist.com/app/settings/integrations/developer"
				target="_blank"
				rel="noreferrer">Todoist → Settings → Integrations → Developer</a
			>.
		</Card.Description>
	</Card.Header>
	<Card.Content class="px-4 sm:px-6">
		<form class="flex flex-col gap-3" onsubmit={submit}>
			<div class="flex flex-col gap-1.5">
				<Label for="token">API token</Label>
				<Input
					id="token"
					class="h-10 sm:h-9"
					type="password"
					autocomplete="off"
					bind:value={token}
					aria-invalid={error ? true : undefined}
				/>
				{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
			</div>
			<p class="text-xs text-muted-foreground">
				Stored in this browser only. It's sent to this app's server, which passes it on to Todoist.
			</p>
			<Button type="submit" class="h-10 sm:h-9" disabled={!token.trim()}>Connect</Button>
		</form>
	</Card.Content>
</Card.Root>
