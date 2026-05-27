<script lang="ts">
	import { registerVolunteer } from '$lib/api';

	let {
		pubkey,
		onRegistered
	}: {
		pubkey: string;
		onRegistered: () => void;
	} = $props();

	let inviteToken = $state('');
	let displayName = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);

	function shortKey(hex: string): string {
		return hex.slice(0, 8) + '…' + hex.slice(-4);
	}

	async function submit() {
		if (!inviteToken.trim()) return;
		submitting = true;
		error = null;
		try {
			await registerVolunteer(pubkey, inviteToken.trim(), displayName.trim());
			onRegistered();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Registration failed';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="hero min-h-[60vh]">
	<div class="hero-content w-full max-w-md">
		<div class="card bg-base-100 shadow-sm w-full">
			<div class="card-body gap-4">
				<h2 class="card-title text-xl">Join as a Volunteer</h2>
				<p class="text-base-content/60 text-sm">
					You're signed in as <span class="font-mono">{shortKey(pubkey)}</span> but not yet registered.
					Enter an invite code from an existing volunteer to join.
				</p>

				<form class="flex flex-col gap-3" onsubmit={(e) => { e.preventDefault(); submit(); }}>
					<div class="form-control gap-1">
						<label class="label label-text text-sm" for="displayName">Display name <span class="text-base-content/40">(optional)</span></label>
						<input
							id="displayName"
							class="input input-bordered"
							type="text"
							placeholder="Your name"
							bind:value={displayName}
							disabled={submitting}
							maxlength={64}
						/>
					</div>

					<div class="form-control gap-1">
						<label class="label label-text text-sm" for="inviteToken">Invite code <span class="text-error">*</span></label>
						<input
							id="inviteToken"
							class="input input-bordered font-mono"
							type="text"
							placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
							bind:value={inviteToken}
							disabled={submitting}
						/>
					</div>

					{#if error}
						<div class="alert alert-error text-sm py-2">
							<span>{error}</span>
						</div>
					{/if}

					<button
						class="btn btn-primary"
						type="submit"
						disabled={submitting || !inviteToken.trim()}
					>
						{#if submitting}
							<span class="loading loading-spinner loading-sm"></span>
						{:else}
							Register
						{/if}
					</button>
				</form>
			</div>
		</div>
	</div>
</div>
