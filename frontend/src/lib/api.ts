import { PUBLIC_API_BASE } from '$env/static/public';
import { buildNip98Header, buildNip98HeaderLocal } from './nostr';

// ---------------------------------------------------------------------------
// Auth state — extension signs events, or local key signs them in-browser
// ---------------------------------------------------------------------------

export type AuthState =
	| { mode: 'extension' }
	| { mode: 'local'; secretKey: Uint8Array; pubkey: string };

export function getPubkey(auth: AuthState): string {
	if (auth.mode === 'local') return auth.pubkey;
	throw new Error('Pubkey not available synchronously for extension mode — use getPublicKeyFromExtension()');
}

async function buildHeader(url: string, method: string, auth: AuthState): Promise<string> {
	if (auth.mode === 'extension') return buildNip98Header(url, method);
	return buildNip98HeaderLocal(url, method, auth.secretKey);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AuthError extends Error {
	status: number;
	constructor(status: number) {
		super(
			status === 403
				? 'Your Nostr key is not authorized for this action.'
				: 'Authorization failed.'
		);
		this.name = 'AuthError';
		this.status = status;
	}
}

// ---------------------------------------------------------------------------
// Shared fetch helpers
// ---------------------------------------------------------------------------

async function authedFetch(
	path: string,
	auth: AuthState,
	method = 'GET',
	body?: unknown
): Promise<Response> {
	const url = `${PUBLIC_API_BASE}${path}`;
	const authHeader = await buildHeader(url, method, auth);
	const res = await fetch(url, {
		method,
		headers: {
			Authorization: authHeader,
			'Content-Type': 'application/json'
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
	return res;
}

// ---------------------------------------------------------------------------
// Volunteer status (unauthenticated)
// ---------------------------------------------------------------------------

export interface VolunteerStatus {
	is_volunteer: boolean;
	is_admin: boolean;
	display_name: string | null;
}

export async function fetchVolunteerStatus(pubkey: string): Promise<VolunteerStatus> {
	const res = await fetch(
		`${PUBLIC_API_BASE}/api/volunteers/status?pubkey=${encodeURIComponent(pubkey)}`
	);
	if (!res.ok) throw new Error('Status check failed');
	return res.json() as Promise<VolunteerStatus>;
}

// ---------------------------------------------------------------------------
// Registration (unauthenticated — pubkey ownership proven by invite token)
// ---------------------------------------------------------------------------

export async function registerVolunteer(
	pubkey: string,
	inviteToken: string,
	displayName: string
): Promise<void> {
	const res = await fetch(`${PUBLIC_API_BASE}/api/volunteers/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			pubkey,
			invite_token: inviteToken,
			display_name: displayName
		})
	});
	if (res.status === 400) {
		const data = await res.json().catch(() => ({}));
		throw new Error((data as { detail?: string }).detail ?? 'Registration failed');
	}
	if (!res.ok) throw new Error('Registration failed');
}

// ---------------------------------------------------------------------------
// Volunteer-authed endpoints
// ---------------------------------------------------------------------------

export interface PendingInvite {
	token: string;
	created_at: string;
	expires_at: string;
}

export interface MyProfile {
	pubkey: string;
	display_name: string | null;
	status: string;
	registered_at: string;
	pending_invites: PendingInvite[];
}

export async function fetchMyProfile(auth: AuthState): Promise<MyProfile> {
	const res = await authedFetch('/api/volunteers/me', auth);
	if (!res.ok) throw new Error('Failed to fetch profile');
	return res.json() as Promise<MyProfile>;
}

export async function updateMyDisplayName(name: string, auth: AuthState): Promise<void> {
	const res = await authedFetch('/api/volunteers/me', auth, 'PATCH', { display_name: name });
	if (!res.ok) throw new Error('Failed to update display name');
}

export async function createInviteToken(auth: AuthState): Promise<PendingInvite> {
	const res = await authedFetch('/api/volunteers/invite', auth, 'POST');
	if (res.status === 403) throw new AuthError(403);
	if (!res.ok) throw new Error('Failed to create invite token');
	const data = (await res.json()) as { invite_token: string; expires_at: string };
	return { token: data.invite_token, created_at: new Date().toISOString(), expires_at: data.expires_at };
}

export interface Invitee {
	pubkey: string;
	display_name: string | null;
	status: string;
	registered_at: string;
}

export async function fetchMyInvitees(auth: AuthState): Promise<Invitee[]> {
	const res = await authedFetch('/api/volunteers/me/invitees', auth);
	if (!res.ok) throw new Error('Failed to fetch invitees');
	const data = (await res.json()) as { invitees: Invitee[] };
	return data.invitees;
}

// ---------------------------------------------------------------------------
// Admin-authed endpoints
// ---------------------------------------------------------------------------

export type VolunteerStatus2 = 'active' | 'banned';

export interface Volunteer {
	pubkey: string;
	status: VolunteerStatus2;
	display_name: string | null;
	invited_by: string | null;
	registered_at: string;
	is_admin: boolean;
}

export async function fetchVolunteers(auth: AuthState): Promise<Volunteer[]> {
	const res = await authedFetch('/api/admin/volunteers', auth);
	if (!res.ok) throw new Error(`Failed to fetch volunteers: ${res.status}`);
	const data = (await res.json()) as { volunteers: Volunteer[] };
	return data.volunteers;
}

export async function addVolunteer(pubkey: string, auth: AuthState): Promise<Volunteer> {
	const res = await authedFetch('/api/admin/volunteers', auth, 'POST', { pubkey });
	if (res.status === 409) throw new Error('Volunteer already registered');
	if (res.status === 400) throw new Error('Invalid pubkey format');
	if (!res.ok) throw new Error(`Failed to add volunteer: ${res.status}`);
	return res.json() as Promise<Volunteer>;
}

export async function banVolunteer(
	pubkey: string,
	cascade: boolean,
	auth: AuthState
): Promise<void> {
	const res = await authedFetch(`/api/admin/ban/${pubkey}`, auth, 'POST', { cascade });
	if (res.status === 403) throw new Error('Cannot ban an admin');
	if (!res.ok) throw new Error(`Ban failed: ${res.status}`);
}

export async function unbanVolunteer(pubkey: string, auth: AuthState): Promise<void> {
	const res = await authedFetch(`/api/admin/unban/${pubkey}`, auth, 'POST');
	if (!res.ok) throw new Error(`Unban failed: ${res.status}`);
}
