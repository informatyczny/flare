<script lang="ts">
	import { approveEvent, AuthError, fetchQueue, rejectEvent, type QueuedEvent } from '$lib/api';

	let { onAuthError }: { onAuthError: () => void } = $props();

	let queue = $state<QueuedEvent[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let actionPending = $state<Set<string>>(new Set());

	export async function load() {
		loading = true;
		error = null;
		try {
			queue = await fetchQueue();
		} catch (e) {
			if (e instanceof AuthError) onAuthError();
			else error = e instanceof Error ? e.message : 'Failed to load queue';
		} finally {
			loading = false;
		}
	}

	async function approve(id: string) {
		actionPending = new Set([...actionPending, id]);
		error = null;
		try {
			await approveEvent(id);
			queue = queue.filter((e) => e.facebook_id !== id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Approve failed';
		} finally {
			actionPending.delete(id);
			actionPending = new Set(actionPending);
		}
	}

	async function reject(id: string) {
		actionPending = new Set([...actionPending, id]);
		error = null;
		try {
			await rejectEvent(id);
			queue = queue.filter((e) => e.facebook_id !== id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Reject failed';
		} finally {
			actionPending.delete(id);
			actionPending = new Set(actionPending);
		}
	}

	function fmt(ts: number): string {
		return new Date(ts * 1000).toLocaleString(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	function shortKey(hex: string): string {
		return hex.slice(0, 8) + '…' + hex.slice(-4);
	}
</script>

{#if error}
	<div class="alert alert-error mb-4">
		<span>{error}</span>
		<button class="btn btn-ghost btn-xs ml-auto" onclick={() => (error = null)}>✕</button>
	</div>
{/if}

{#if loading}
	<div class="flex justify-center py-20">
		<span class="loading loading-spinner loading-lg"></span>
	</div>

{:else if queue.length === 0}
	<div class="card bg-base-100 shadow-sm">
		<div class="card-body items-center text-center py-16">
			<div class="text-5xl mb-4">✓</div>
			<p class="text-base-content/60">Queue is empty — nothing to review.</p>
		</div>
	</div>

{:else}
	<div class="flex flex-col gap-4">
		{#each queue as item (item.facebook_id)}
			{@const ev = item.parsed}
			{@const busy = actionPending.has(item.facebook_id)}
			<div class="card bg-base-100 shadow-sm">
				<div class="card-body gap-3">
					<div class="flex items-start justify-between gap-4">
						<h3 class="card-title text-lg leading-snug">
							{ev?.title ?? item.facebook_id}
						</h3>
						<div class="badge badge-secondary badge-outline shrink-0">
							{item.consensus_count} confirmation{item.consensus_count !== 1 ? 's' : ''}
						</div>
					</div>

					<div class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-base-content/70">
						{#if ev?.start}
							<span>📅 {fmt(ev.start)}{ev.end ? ' → ' + fmt(ev.end) : ''}</span>
						{/if}
						{#if ev?.location}
							<span>📍 {ev.location}</span>
						{/if}
						{#if ev?.city}
							<span>🏙 {ev.city}</span>
						{/if}
					</div>

					{#if ev?.description}
						<p class="text-sm text-base-content/80 line-clamp-3">{ev.description}</p>
					{/if}

					{#if ev?.cover_url}
						<img src={ev.cover_url} alt="Event cover" class="rounded-lg max-h-48 object-cover w-full" />
					{/if}

					<div class="divider my-0"></div>

					<div class="flex flex-wrap items-center gap-3">
						<span class="text-xs text-base-content/50 font-mono">
							volunteer: {shortKey(item.volunteer_pubkey)}
						</span>
						{#if ev?.source_url}
							<a href={ev.source_url} target="_blank" rel="noopener noreferrer" class="link link-primary text-xs">
								View on Facebook ↗
							</a>
						{/if}
						<div class="ml-auto flex gap-2">
							<button class="btn btn-error btn-sm" onclick={() => reject(item.facebook_id)} disabled={busy}>
								{#if busy}<span class="loading loading-spinner loading-xs"></span>{:else}Reject{/if}
							</button>
							<button class="btn btn-success btn-sm" onclick={() => approve(item.facebook_id)} disabled={busy}>
								{#if busy}<span class="loading loading-spinner loading-xs"></span>{:else}Approve{/if}
							</button>
						</div>
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}
