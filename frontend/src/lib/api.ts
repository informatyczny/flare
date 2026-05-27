import { PUBLIC_API_BASE } from '$env/static/public';
import { buildNip98Header } from './nostr';

export interface EventPayload {
	facebook_id: string;
	title: string;
	start: number;
	end?: number;
	description?: string;
	location?: string;
	cover_url?: string;
	source_url: string;
	city?: string;
	volunteer_pubkey: string;
}

export interface QueuedEvent {
	facebook_id: string;
	volunteer_pubkey: string;
	event_data: string;
	consensus_count: number;
	parsed?: EventPayload;
}

export type VolunteerStatus = 'probation' | 'trusted' | 'banned';

export interface Volunteer {
	pubkey: string;
	nickname: string;
	status: VolunteerStatus;
	approval_count: number;
	created_at: string;
	invited_by_pubkey: string | null;
	invited_by_nickname: string | null;
	invite_count: number;
}

export class AuthError extends Error {
	constructor(status: number) {
		super(status === 403 ? 'Your Nostr key is not registered as an admin.' : 'Authorization failed.');
		this.name = 'AuthError';
	}
}

async function authedFetch(path: string, method = 'GET', body?: unknown): Promise<Response> {
	const url = `${PUBLIC_API_BASE}${path}`;
	const auth = await buildNip98Header(url, method);

	const res = await fetch(url, {
		method,
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json'
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});

	if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
	return res;
}

export async function checkIsAdmin(pubkey: string): Promise<boolean> {
	const res = await fetch(`${PUBLIC_API_BASE}/api/admin/check?pubkey=${encodeURIComponent(pubkey)}`);
	if (!res.ok) return false;
	const data = await res.json();
	return data.is_admin === true;
}

export async function fetchQueue(): Promise<QueuedEvent[]> {
	const res = await authedFetch('/api/admin/queue');
	if (!res.ok) throw new Error(`Failed to fetch queue: ${res.status}`);
	const data = await res.json();
	return (data.events as QueuedEvent[]).map((e) => ({
		...e,
		parsed: tryParse(e.event_data)
	}));
}

export async function approveEvent(facebook_id: string): Promise<void> {
	const res = await authedFetch(`/api/admin/queue/${facebook_id}/approve`, 'POST');
	if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
}

export async function rejectEvent(facebook_id: string): Promise<void> {
	const res = await authedFetch(`/api/admin/queue/${facebook_id}/reject`, 'POST');
	if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
}

export async function fetchVolunteers(): Promise<Volunteer[]> {
	const res = await authedFetch('/api/admin/volunteers');
	if (!res.ok) throw new Error(`Failed to fetch volunteers: ${res.status}`);
	const data = await res.json();
	return data.volunteers as Volunteer[];
}

export async function setVolunteerStatus(pubkey: string, status: VolunteerStatus): Promise<void> {
	const res = await authedFetch(`/api/admin/volunteers/${pubkey}/status`, 'POST', { status });
	if (!res.ok) throw new Error(`Status update failed: ${res.status}`);
}

function tryParse(json: string): EventPayload | undefined {
	try {
		return JSON.parse(json);
	} catch {
		return undefined;
	}
}
