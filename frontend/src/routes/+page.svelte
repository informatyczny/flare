<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchVolunteerStatus, type AuthState } from '$lib/api';
	import {
		getPublicKeyFromExtension,
		getPubkeyFromSecretKey,
		hasNostrExtension,
		parsePrivateKey
	} from '$lib/nostr';
	import RegistrationForm from '$lib/components/RegistrationForm.svelte';
	import VolunteerDashboard from '$lib/components/VolunteerDashboard.svelte';
	import VolunteersTab from '$lib/components/VolunteersTab.svelte';

	// ---------------------------------------------------------------------------
	// Auth state
	// ---------------------------------------------------------------------------

	let auth = $state<AuthState | null>(null);
	let pubkey = $state<string | null>(null);

	// Post-auth status
	let isVolunteer = $state(false);
	let isAdmin = $state(false);
	let displayName = $state<string | null>(null);
	let checking = $state(false);
	let statusError = $state<string | null>(null);

	// Login UI
	let extensionAvailable = $state(false);
	let connecting = $state(false);
	let connectError = $state<string | null>(null);
	let secretKeyInput = $state('');
	let showKeyInput = $state(false);

	// Navigation
	let activeTab = $state<'dashboard' | 'admin'>('dashboard');

	onMount(() => {
		extensionAvailable = hasNostrExtension();
	});

	async function checkStatus(pk: string) {
		checking = true;
		statusError = null;
		console.log("checking status...")
		try {
			const status = await fetchVolunteerStatus(pk);
			isVolunteer = status.is_volunteer;
			isAdmin = status.is_admin;
			displayName = status.display_name;
			activeTab = 'dashboard';
			console.log("checked status and it's" + isAdmin)
		} catch {
			statusError = 'Could not reach server. Please try again.';
			auth = null;
			pubkey = null;
			console.log("error while checking status!")
		} finally {
			checking = false;
		}
	}

	async function connectExtension() {
		connecting = true;
		connectError = null;
		try {
			const pk = await getPublicKeyFromExtension();
			pubkey = pk;
			auth = { mode: 'extension' };
			await checkStatus(pk);
		} catch (e) {
			connectError = e instanceof Error ? e.message : 'Failed to connect';
			auth = null;
			pubkey = null;
		} finally {
			connecting = false;
		}
	}

	function connectLocalKey() {
		connectError = null;
		const secretKey = parsePrivateKey(secretKeyInput);
		if (!secretKey) {
			connectError = 'Invalid private key. Enter a 64-char hex or nsec1… key.';
			return;
		}
		const pk = getPubkeyFromSecretKey(secretKey);
		pubkey = pk;
		auth = { mode: 'local', secretKey, pubkey: pk };
		secretKeyInput = '';
		checkStatus(pk);
	}

	function disconnect() {
		auth = null;
		pubkey = null;
		isVolunteer = false;
		isAdmin = false;
		displayName = null;
		connectError = null;
		statusError = null;
		activeTab = 'dashboard';
	}

	function onAuthError() {
		disconnect();
		connectError = 'Session expired — please sign in again.';
	}

	// Called after successful registration so we refresh status
	async function onRegistered() {
		if (pubkey) await checkStatus(pubkey);
	}

	function shortKey(hex: string): string {
		return hex.slice(0, 8) + '…' + hex.slice(-4);
	}
</script>

<div class="min-h-screen bg-base-200">
	<!-- Navbar -->
	<div class="navbar bg-base-100 shadow-sm px-4">
		<div class="flex-1 gap-3 flex items-center">
			<span class="text-xl font-bold tracking-tight">FLARE</span>
			{#if pubkey}
				<div class="flex items-center gap-2">
					<div class="badge badge-neutral font-mono text-xs" title={pubkey}>{shortKey(pubkey)}</div>
					{#if displayName}
						<span class="text-sm text-base-content/70">{displayName}</span>
					{/if}
				</div>
			{/if}
		</div>

		{#if pubkey && isVolunteer}
			<div class="flex-none">
				<!-- Tab links -->
				<div class="tabs tabs-bordered mr-4">
					<button
						class="tab {activeTab === 'dashboard' ? 'tab-active' : ''}"
						onclick={() => (activeTab = 'dashboard')}
					>
						Dashboard
					</button>
					{#if isAdmin}
						<button
							class="tab {activeTab === 'admin' ? 'tab-active' : ''}"
							onclick={() => (activeTab = 'admin')}
						>
							Admin
						</button>
					{/if}
				</div>
			</div>
		{/if}

		{#if auth}
			<div class="flex-none">
				<button class="btn btn-ghost btn-sm" onclick={disconnect}>Disconnect</button>
			</div>
		{/if}
	</div>

	<main class="max-w-5xl mx-auto p-6">

		<!-- Error banners -->
		{#if connectError}
			<div class="alert alert-error mb-6">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
				</svg>
				<span>{connectError}</span>
				<button class="btn btn-ghost btn-xs ml-auto" onclick={() => (connectError = null)}>✕</button>
			</div>
		{/if}

		{#if statusError}
			<div class="alert alert-error mb-6">
				<span>{statusError}</span>
			</div>
		{/if}

		<!-- Not connected -->
		{#if !auth}
			<div class="hero min-h-[60vh]">
				<div class="hero-content w-full max-w-md flex-col">
					<div class="text-center">
						<h1 class="text-4xl font-bold mb-2">FLARE Volunteers</h1>
						<p class="text-base-content/60 mb-8">
							Sign in with your Nostr identity to manage your volunteer account.
						</p>
					</div>

					<div class="card bg-base-100 shadow-sm w-full">
						<div class="card-body gap-4">

							<!-- Extension sign-in -->
							{#if extensionAvailable}
								<button
									class="btn btn-primary w-full"
									onclick={connectExtension}
									disabled={connecting}
								>
									{#if connecting}
										<span class="loading loading-spinner loading-sm"></span>
									{:else}
										Sign in with Nostr Extension
									{/if}
								</button>
							{:else}
								<div class="alert alert-warning text-sm">
									No Nostr extension detected. Install
									<a href="https://getalby.com" target="_blank" class="link">Alby</a> or
									<a href="https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp" target="_blank" class="link">nos2x</a>
									for one-click sign-in.
								</div>
							{/if}

							<div class="divider text-xs">or</div>

							<!-- Local key sign-in -->
							{#if !showKeyInput}
								<button
									class="btn btn-outline w-full"
									onclick={() => (showKeyInput = true)}
								>
									Enter private key
								</button>
							{:else}
								<div class="flex flex-col gap-2">
									<label class="label label-text text-sm" for="secretKeyInput">
										Private key
										<span class="text-base-content/40 text-xs">— never sent to server</span>
									</label>
									<input
										id="secretKeyInput"
										class="input input-bordered font-mono text-sm"
										type="password"
										placeholder="nsec1… or 64-char hex"
										bind:value={secretKeyInput}
										onkeydown={(e) => e.key === 'Enter' && connectLocalKey()}
									/>
									<div class="flex gap-2">
										<button
											class="btn btn-primary flex-1"
											onclick={connectLocalKey}
											disabled={!secretKeyInput.trim()}
										>
											Sign in
										</button>
										<button
											class="btn btn-ghost"
											onclick={() => { showKeyInput = false; secretKeyInput = ''; }}
										>
											Cancel
										</button>
									</div>
								</div>
							{/if}

						</div>
					</div>
				</div>
			</div>

		<!-- Checking status -->
		{:else if checking}
			<div class="flex justify-center py-20">
				<span class="loading loading-spinner loading-lg"></span>
			</div>

		<!-- Not a volunteer yet — show registration -->
		{:else if !isVolunteer}
			<RegistrationForm pubkey={pubkey!} {onRegistered} />

		<!-- Volunteer dashboard -->
		{:else if activeTab === 'dashboard'}
			<VolunteerDashboard auth={auth!} {onAuthError} />

		<!-- Admin tab -->
		{:else if activeTab === 'admin' && isAdmin}
			<VolunteersTab auth={auth!} {onAuthError} />

		{/if}
	</main>
</div>
