<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { checkIsAdmin } from '$lib/api';
	import { getPublicKey, hasNostrExtension } from '$lib/nostr';
	import QueueTab from '$lib/components/QueueTab.svelte';
	import VolunteersTab from '$lib/components/VolunteersTab.svelte';

	let pubkey = $state<string | null>(null);
	let activeTab = $state<'queue' | 'volunteers'>('queue');
	let error = $state<string | null>(null);
	let extensionMissing = $state(false);
	let connecting = $state(false);

	let queueTab = $state<QueueTab>();
	let volunteersTab = $state<VolunteersTab>();

	onMount(() => {
		extensionMissing = !hasNostrExtension();
	});

	async function connect() {
		connecting = true;
		error = null;
		try {
			const key = await getPublicKey();
			if (!(await checkIsAdmin(key))) {
				error = 'Your Nostr key is not registered as an admin.';
				return;
			}
			pubkey = key;
			await tick(); // wait for DOM to render the tab components before calling load()
			await queueTab!.load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to connect';
			pubkey = null;
		} finally {
			connecting = false;
		}
	}

	function disconnect() {
		pubkey = null;
		activeTab = 'queue';
		error = null;
	}

	function onAuthError() {
		disconnect();
		error = 'Session expired — please reconnect.';
	}

	async function switchTab(tab: 'queue' | 'volunteers') {
		activeTab = tab;
		if (tab === 'queue') await queueTab!.load();
		else await volunteersTab!.load();
	}

	function shortKey(hex: string): string {
		return hex.slice(0, 8) + '…' + hex.slice(-4);
	}
</script>

<div class="min-h-screen bg-base-200">
	<!-- Navbar -->
	<div class="navbar bg-base-100 shadow-sm px-4">
		<div class="flex-1 gap-3">
			<span class="text-xl font-bold tracking-tight">FLARE Admin</span>
			{#if pubkey}
				<div class="badge badge-neutral font-mono text-xs">{shortKey(pubkey)}</div>
			{/if}
		</div>
		{#if pubkey}
			<div class="flex-none gap-2">
				<button class="btn btn-ghost btn-sm" onclick={disconnect}>Disconnect</button>
			</div>
		{/if}
	</div>

	<main class="max-w-5xl mx-auto p-6">
		<!-- Error banner -->
		{#if error}
			<div class="alert alert-error mb-6">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
				</svg>
				<span>{error}</span>
				<button class="btn btn-ghost btn-xs ml-auto" onclick={() => (error = null)}>✕</button>
			</div>
		{/if}

		<!-- Not connected -->
		{#if !pubkey}
			<div class="hero min-h-[60vh]">
				<div class="hero-content text-center">
					<div class="max-w-sm">
						<h1 class="text-4xl font-bold mb-2">Admin Panel</h1>
						<p class="text-base-content/60 mb-8">
							Sign in with your Nostr identity to manage events and volunteers.
						</p>
						{#if extensionMissing}
							<div class="alert alert-warning mb-4 text-sm">
								No Nostr extension detected. Install
								<a href="https://getalby.com" target="_blank" class="link">Alby</a> or
								<a href="https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp" target="_blank" class="link">nos2x</a>.
							</div>
						{:else}
							<button class="btn btn-primary btn-lg w-full" onclick={connect} disabled={connecting}>
								{#if connecting}
									<span class="loading loading-spinner loading-sm"></span>
								{:else}
									Connect with Nostr
								{/if}
							</button>
						{/if}
					</div>
				</div>
			</div>

		<!-- Connected -->
		{:else}
			<!-- Tabs -->
			<div role="tablist" class="tabs tabs-box mb-6">
				<button
					role="tab"
					class="tab {activeTab === 'queue' ? 'tab-active' : ''}"
					onclick={() => switchTab('queue')}
				>
					Event Queue
				</button>
				<button
					role="tab"
					class="tab {activeTab === 'volunteers' ? 'tab-active' : ''}"
					onclick={() => switchTab('volunteers')}
				>
					Volunteers
				</button>
			</div>

			<div class:hidden={activeTab !== 'queue'}>
				<QueueTab bind:this={queueTab} {onAuthError} />
			</div>
			<div class:hidden={activeTab !== 'volunteers'}>
				<VolunteersTab bind:this={volunteersTab} {onAuthError} />
			</div>
		{/if}
	</main>
</div>
