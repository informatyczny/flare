<script lang="ts">
	import { AuthError, fetchVolunteers, setVolunteerStatus, type Volunteer, type VolunteerStatus } from '$lib/api';

	let { onAuthError }: { onAuthError: () => void } = $props();

	let volunteers = $state<Volunteer[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let actionPending = $state<Set<string>>(new Set());

	export async function load() {
		loading = true;
		error = null;
		try {
			volunteers = await fetchVolunteers();
		} catch (e) {
			if (e instanceof AuthError) onAuthError();
			else error = e instanceof Error ? e.message : 'Failed to load volunteers';
		} finally {
			loading = false;
		}
	}

	async function updateStatus(pubkey: string, status: VolunteerStatus) {
		actionPending = new Set([...actionPending, pubkey]);
		error = null;
		try {
			await setVolunteerStatus(pubkey, status);
			volunteers = volunteers.map((v) => v.pubkey === pubkey ? { ...v, status } : v);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Status update failed';
		} finally {
			actionPending.delete(pubkey);
			actionPending = new Set(actionPending);
		}
	}

	const statusBadge: Record<VolunteerStatus, string> = {
		trusted:   'badge-success',
		probation: 'badge-warning',
		banned:    'badge-error',
	};

	function shortKey(hex: string): string {
		return hex.slice(0, 8) + '…' + hex.slice(-4);
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
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

{:else if volunteers.length === 0}
	<div class="card bg-base-100 shadow-sm">
		<div class="card-body items-center text-center py-16">
			<p class="text-base-content/60">No volunteers registered yet.</p>
		</div>
	</div>

{:else}
	<div class="overflow-x-auto rounded-box shadow-sm">
		<table class="table table-zebra bg-base-100">
			<thead>
				<tr>
					<th>Volunteer</th>
					<th>Status</th>
					<th>Approvals</th>
					<th>Invited by</th>
					<th>Invited</th>
					<th>Joined</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each volunteers as v (v.pubkey)}
					{@const busy = actionPending.has(v.pubkey)}
					<tr>
						<td>
							<div class="font-medium">{v.nickname}</div>
							<div class="text-xs text-base-content/50 font-mono">{shortKey(v.pubkey)}</div>
						</td>
						<td>
							<span class="badge {statusBadge[v.status]} badge-sm capitalize">{v.status}</span>
						</td>
						<td class="tabular-nums">{v.approval_count}</td>
						<td>
							{#if v.invited_by_nickname}
								<div>{v.invited_by_nickname}</div>
								<div class="text-xs text-base-content/50 font-mono">{shortKey(v.invited_by_pubkey!)}</div>
							{:else}
								<span class="text-base-content/30">—</span>
							{/if}
						</td>
						<td class="tabular-nums">{v.invite_count}</td>
						<td class="text-sm text-base-content/70">{fmtDate(v.created_at)}</td>
						<td>
							{#if busy}
								<span class="loading loading-spinner loading-xs"></span>
							{:else}
								<div class="flex gap-1">
									{#if v.status !== 'trusted'}
										<button class="btn btn-success btn-xs" onclick={() => updateStatus(v.pubkey, 'trusted')}>
											Trust
										</button>
									{/if}
									{#if v.status !== 'probation'}
										<button class="btn btn-warning btn-xs" onclick={() => updateStatus(v.pubkey, 'probation')}>
											Probation
										</button>
									{/if}
									{#if v.status !== 'banned'}
										<button class="btn btn-error btn-xs" onclick={() => updateStatus(v.pubkey, 'banned')}>
											Ban
										</button>
									{/if}
								</div>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
