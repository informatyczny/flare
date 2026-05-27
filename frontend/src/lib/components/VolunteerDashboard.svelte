<script lang="ts">
	import {
		AuthError,
		createInviteToken,
		fetchMyInvitees,
		fetchMyProfile,
		updateMyDisplayName,
		type AuthState,
		type Invitee,
		type MyProfile,
		type PendingInvite
	} from '$lib/api';

	let {
		auth,
		onAuthError
	}: {
		auth: AuthState;
		onAuthError: () => void;
	} = $props();

	let profile = $state<MyProfile | null>(null);
	let invitees = $state<Invitee[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Display name editing
	let editingName = $state(false);
	let nameInput = $state('');
	let savingName = $state(false);
	let nameError = $state<string | null>(null);

	// Invite creation
	let creatingInvite = $state(false);
	let inviteError = $state<string | null>(null);
	let copiedToken = $state<string | null>(null);

	const MAX_INVITES = 3;

	async function load() {
		loading = true;
		error = null;
		try {
			profile = await fetchMyProfile(auth);
			invitees = await fetchMyInvitees(auth);
		} catch (e) {
			if (e instanceof AuthError) onAuthError();
			else error = e instanceof Error ? e.message : 'Failed to load';
		} finally {
			loading = false;
		}
	}

	load();

	function startEditName() {
		nameInput = profile?.display_name ?? '';
		nameError = null;
		editingName = true;
	}

	async function saveName() {
		if (!profile) return;
		savingName = true;
		nameError = null;
		try {
			await updateMyDisplayName(nameInput.trim(), auth);
			profile = { ...profile, display_name: nameInput.trim() || null };
			editingName = false;
		} catch (e) {
			if (e instanceof AuthError) onAuthError();
			else nameError = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			savingName = false;
		}
	}

	async function generateInvite() {
		if (!profile) return;
		creatingInvite = true;
		inviteError = null;
		try {
			const invite = await createInviteToken(auth);
			profile = { ...profile, pending_invites: [...profile.pending_invites, invite] };
		} catch (e) {
			if (e instanceof AuthError) onAuthError();
			else inviteError = e instanceof Error ? e.message : 'Failed to create invite';
		} finally {
			creatingInvite = false;
		}
	}

	async function copyToken(token: string) {
		await navigator.clipboard.writeText(token);
		copiedToken = token;
		setTimeout(() => { copiedToken = null; }, 1500);
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
	}

	function shortKey(hex: string): string {
		return hex.slice(0, 8) + '…' + hex.slice(-4);
	}
</script>

{#if loading}
	<div class="flex justify-center py-20">
		<span class="loading loading-spinner loading-lg"></span>
	</div>
{:else if error}
	<div class="alert alert-error">
		<span>{error}</span>
		<button class="btn btn-ghost btn-xs ml-auto" onclick={() => load()}>Retry</button>
	</div>
{:else if profile}
	<div class="flex flex-col gap-6">

		<!-- Profile card -->
		<div class="card bg-base-100 shadow-sm">
			<div class="card-body gap-3">
				<h2 class="card-title text-base">My Identity</h2>

				<div class="flex flex-col gap-1">
					<span class="text-xs text-base-content/50 uppercase tracking-wide">Public key</span>
					<span class="font-mono text-sm break-all">{profile.pubkey}</span>
				</div>

				<div class="flex flex-col gap-1">
					<span class="text-xs text-base-content/50 uppercase tracking-wide">Display name</span>
					{#if editingName}
						<div class="flex gap-2 items-center">
							<input
								class="input input-bordered input-sm flex-1"
								type="text"
								bind:value={nameInput}
								maxlength={64}
								placeholder="Your name"
								disabled={savingName}
							/>
							<button class="btn btn-primary btn-sm" onclick={saveName} disabled={savingName}>
								{#if savingName}
									<span class="loading loading-spinner loading-xs"></span>
								{:else}
									Save
								{/if}
							</button>
							<button class="btn btn-ghost btn-sm" onclick={() => (editingName = false)} disabled={savingName}>Cancel</button>
						</div>
						{#if nameError}
							<p class="text-error text-xs">{nameError}</p>
						{/if}
					{:else}
						<div class="flex items-center gap-2">
							{#if profile.display_name}
								<span class="text-sm">{profile.display_name}</span>
							{:else}
								<span class="text-sm text-base-content/30">—</span>
							{/if}
							<button class="btn btn-ghost btn-xs" onclick={startEditName}>Edit</button>
						</div>
					{/if}
				</div>

				<div class="text-xs text-base-content/40">
					Volunteer since {fmtDate(profile.registered_at)}
				</div>
			</div>
		</div>

		<!-- Invite codes card -->
		<div class="card bg-base-100 shadow-sm">
			<div class="card-body gap-3">
				<div class="flex items-center justify-between">
					<h2 class="card-title text-base">
						Invite Codes
						<span class="badge badge-neutral text-xs font-normal">
							{profile.pending_invites.length}/{MAX_INVITES} active
						</span>
					</h2>
					<button
						class="btn btn-primary btn-sm"
						onclick={generateInvite}
						disabled={creatingInvite || profile.pending_invites.length >= MAX_INVITES}
					>
						{#if creatingInvite}
							<span class="loading loading-spinner loading-xs"></span>
						{:else}
							Generate
						{/if}
					</button>
				</div>

				{#if inviteError}
					<div class="alert alert-error text-sm py-2">
						<span>{inviteError}</span>
					</div>
				{/if}

				{#if profile.pending_invites.length === 0}
					<p class="text-base-content/50 text-sm text-center py-4">
						No active invite codes. Generate one to invite a volunteer.
					</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each profile.pending_invites as invite (invite.token)}
							<div class="bg-base-200 rounded-lg p-3 flex items-center gap-3">
								<code class="font-mono text-xs flex-1 break-all">{invite.token}</code>
								<div class="flex flex-col items-end gap-1 shrink-0">
									<button
										class="btn btn-ghost btn-xs"
										onclick={() => copyToken(invite.token)}
									>
										{copiedToken === invite.token ? '✓' : 'Copy'}
									</button>
									<span class="text-xs text-base-content/40">Expires {fmtDate(invite.expires_at)}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Invitees card -->
		<div class="card bg-base-100 shadow-sm">
			<div class="card-body gap-3">
				<h2 class="card-title text-base">
					My Invitees
					<span class="badge badge-neutral text-xs font-normal">{invitees.length}</span>
				</h2>

				{#if invitees.length === 0}
					<p class="text-base-content/50 text-sm text-center py-4">
						No one has registered using your invite codes yet.
					</p>
				{:else}
					<div class="overflow-x-auto rounded-box">
						<table class="table table-sm">
							<thead>
								<tr>
									<th>Volunteer</th>
									<th>Status</th>
									<th>Joined</th>
								</tr>
							</thead>
							<tbody>
								{#each invitees as inv (inv.pubkey)}
									<tr>
										<td>
											<div class="font-mono text-xs text-base-content/70" title={inv.pubkey}>
												{shortKey(inv.pubkey)}
											</div>
											{#if inv.display_name}
												<div class="text-sm">{inv.display_name}</div>
											{/if}
										</td>
										<td>
											<span class="badge badge-sm {inv.status === 'active' ? 'badge-success' : 'badge-error'} capitalize">
												{inv.status}
											</span>
										</td>
										<td class="text-sm text-base-content/70">{fmtDate(inv.registered_at)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>

	</div>
{/if}
