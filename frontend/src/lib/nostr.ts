export interface NostrEvent {
	kind: number;
	created_at: number;
	tags: string[][];
	content: string;
	pubkey?: string;
	id?: string;
	sig?: string;
}

export interface SignedNostrEvent extends NostrEvent {
	id: string;
	sig: string;
	pubkey: string;
}

declare global {
	interface Window {
		nostr?: {
			getPublicKey(): Promise<string>;
			signEvent(event: NostrEvent): Promise<SignedNostrEvent>;
		};
	}
}

export function hasNostrExtension(): boolean {
	return typeof window !== 'undefined' && typeof window.nostr !== 'undefined';
}

export async function getPublicKey(): Promise<string> {
	if (!window.nostr) throw new Error('No Nostr extension found');
	return window.nostr.getPublicKey();
}

/** Build and sign a NIP-98 HTTP Auth event for the given URL + method. */
export async function buildNip98Header(url: string, method: string): Promise<string> {
	if (!window.nostr) throw new Error('No Nostr extension found');

	const event: NostrEvent = {
		kind: 27235,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['u', url],
			['method', method.toUpperCase()]
		],
		content: ''
	};

	const signed = await window.nostr.signEvent(event);
	return 'Nostr ' + btoa(JSON.stringify(signed));
}
