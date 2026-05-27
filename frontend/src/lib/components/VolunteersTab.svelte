<script lang="ts">
	import {
		addVolunteer,
		AuthError,
		banVolunteer,
		fetchVolunteers,
		unbanVolunteer,
		type AuthState,
		type Volunteer
	} from '$lib/api';

	let {
		auth,
		onAuthError
	}: {
		auth: AuthState;
		onAuthError: () => void;
	} = $props();

	let volunteers = $state<Volunteer[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let actionPending = $state<Set<string>>(new Set());
	let search = $state('');

	let newPubkey = $state('');
	let adding = $state(false);
	let addError = $state<string | null>(null);

	let filtered = $derived(
		search.trim()
			? volunteers.filter(
					(v) =>
						v.pubkey.includes(search.trim().toLowerCase()) ||
						(v.display_name ?? '').toLowerCase().includes(search.trim().toLowerCase())
				)
			: volunteers
	);

	export async function load() {
		loading = true;
		error = null;
		try {
			volunteers = await fetchVolunteers(auth);
		} catch (e) {
			if (e instanceof AuthError && e.status === 401) onAuthError();
			else error = e instanceof Error ? e.message : 'Failed to load volunteers';
		} finally {
			loading = false;
		}
	}

	load();

	async function submitAdd() {
		const input = newPubkey.trim();
		if (!input) return;
		adding = true;
		addError = null;
		try {
			const volunteer = await addVolunteer(input, auth);
			volunteers = [...volunteers, { ...volunteer, is_admin: false }];
			newPubkey = '';
		} catch (e) {
			if (e instanceof AuthError && e.status === 401) onAuthError();
			else addError = e instanceof Error ? e.message : 'Failed to add volunteer';
		} finally {
			adding = false;
		}
	}

	async function toggleBan(v: Volunteer) {
		if (v.is_admin) return;
		actionPending = new Set([...actionPending, v.pubkey]);
		error = null;
		try {
			if (v.status === 'banned') {
				await unbanVolunteer(v.pubkey, auth);
				volunteers = volunteers.map((vol) =>
					vol.pubkey === v.pubkey ? { ...vol, status: 'active' } : vol
				);
			} else {
				await banVolunteer(v.pubkey, false, auth);
				volunteers = volunteers.map((vol) =>
					vol.pubkey === v.pubkey ? { ...vol, status: 'banned' } : vol
				);
			}
		} catch (e) {
			if (e instanceof AuthError && e.status === 401) onAuthError();
			else error = e instanceof Error ? e.message : 'Action failed';
		} finally {
			actionPending.delete(v.pubkey);
			actionPending = new Set(actionPending);
		}
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
	}

	function shortKey(hex: string): string {
		return hex.slice(0, 8) + '…' + hex.slice(-4);
	}
</script>

<!-- Add volunteer form -->
<div class="card bg-base-100 shadow-sm mb-6">
	<div class="card-body gap-3">
		<h2 class="card-title text-base">Add Volunteer</h2>
		<form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); submitAdd(); }}>
			<input
				class="input input-bordered font-mono flex-1"
				type="text"
				placeholder="Pubkey (hex or npub)"
				bind:value={newPubkey}
				disabled={adding}
			/>
			<button class="btn btn-primary" type="submit" disabled={adding || !newPubkey.trim()}>
				{#if adding}
					<span class="loading loading-spinner loading-sm"></span>
				{:else}
					Add
				{/if}
			</button>
		</form>
		{#if addError}
			<p class="text-error text-sm">{addError}</p>
		{/if}
	</div>
</div>

{#if error}
	<div class="alert alert-error mb-4">
		<span>{error}</span>
		<button class="btn btn-ghost btn-xs ml-auto" onclick={() => (error = null)}>✕</button>
	</div>
{/if}

<div class="mb-4">
	<input
		class="input input-bordered w-full"
		type="search"
		placeholder="Search by pubkey or name…"
		bind:value={search}
	/>
</div>

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
{:else if filtered.length === 0}
	<div class="card bg-base-100 shadow-sm">
		<div class="card-body items-center text-center py-16">
			<p class="text-base-content/60">No volunteers match <span class="font-mono">{search}</span>.</p>
		</div>
	</div>
{:else}
	<div class="overflow-x-auto rounded-box shadow-sm">
		<table class="table table-zebra bg-base-100">
			<thead>
				<tr>
					<th>Volunteer</th>
					<th>Status</th>
					<th>Invited by</th>
					<th>Joined</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as v (v.pubkey)}
					{@const busy = actionPending.has(v.pubkey)}
					<tr>
						<td>
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-mono text-xs" title={v.pubkey}>{shortKey(v.pubkey)}</span>
								{#if v.is_admin}
									<span class="badge badge-warning badge-xs">admin</span>
								{/if}
							</div>
							{#if v.display_name}
								<div class="text-sm text-base-content/70">{v.display_name}</div>
							{/if}
						</td>
						<td>
							<span class="badge badge-sm {v.status === 'active' ? 'badge-success' : 'badge-error'} capitalize">
								{v.status}
							</span>
						</td>
						<td class="font-mono text-xs text-base-content/70">
							{#if v.invited_by}
								{shortKey(v.invited_by)}
							{:else}
								<span class="text-base-content/30">—</span>
							{/if}
						</td>
						<td class="text-sm text-base-content/70">{fmtDate(v.registered_at)}</td>
						<td>
							{#if v.is_admin}
								<span class="text-base-content/30 text-xs">protected</span>
							{:else if busy}
								<span class="loading loading-spinner loading-xs"></span>
							{:else if v.status === 'active'}
								<button class="btn btn-error btn-xs" onclick={() => toggleBan(v)}>Ban</button>
							{:else}
								<button class="btn btn-success btn-xs" onclick={() => toggleBan(v)}>Unban</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
