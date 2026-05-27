import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { decode } from 'nostr-tools/nip19';

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

export async function getPublicKeyFromExtension(): Promise<string> {
	if (!window.nostr) throw new Error('No Nostr extension found');
	return window.nostr.getPublicKey();
}

/** Parse an nsec1 bech32 or 64-char hex private key into raw bytes. Returns null on failure. */
export function parsePrivateKey(input: string): Uint8Array | null {
	const trimmed = input.trim();
	if (trimmed.startsWith('nsec1')) {
		try {
			const decoded = decode(trimmed);
			if (decoded.type === 'nsec') return decoded.data as Uint8Array;
		} catch {
			// fall through
		}
		return null;
	}
	if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
		const bytes = new Uint8Array(32);
		for (let i = 0; i < 32; i++) {
			bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
		}
		return bytes;
	}
	return null;
}

export function getPubkeyFromSecretKey(secretKey: Uint8Array): string {
	return getPublicKey(secretKey);
}

/** Build and sign a NIP-98 HTTP Auth event using the Nostr browser extension. */
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

/** Build and sign a NIP-98 HTTP Auth event locally using a raw secret key. */
export function buildNip98HeaderLocal(
	url: string,
	method: string,
	secretKey: Uint8Array
): string {
	const event = finalizeEvent(
		{
			kind: 27235,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['u', url],
				['method', method.toUpperCase()]
			],
			content: ''
		},
		secretKey
	);
	return 'Nostr ' + btoa(JSON.stringify(event));
}
