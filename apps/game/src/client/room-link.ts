import { generateId, isId } from '@clicker/protocol';

const HOST_KEYS = 'clicker.hostKeys';
const PLAYER_ID = 'clicker.playerId';
const NAME = 'clicker.name';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private window or storage blocked: this doesn't get in the way of playing.
  }
}

let cachedPlayerId: string | null = null;
const memoryHostKeys = new Map<string, string>();

/** Persistent player identifier. It's a session secret and never leaves the client. */
export function playerId(): string {
  if (cachedPlayerId !== null) return cachedPlayerId;
  const stored = read(PLAYER_ID);
  const id = stored !== null && isId(stored) ? stored : generateId();
  write(PLAYER_ID, id);
  cachedPlayerId = id;
  return id;
}

export function savedName(): string {
  return read(NAME) ?? '';
}

export function saveName(name: string): void {
  write(NAME, name);
}

/** `/r/<roomId>` — the link itself is the invitation. */
export function roomIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{22})$/);
  return match?.[1] ?? null;
}

function hostKeys(): Record<string, string> {
  const raw = read(HOST_KEYS);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function hostKeyFor(roomId: string): string | undefined {
  return memoryHostKeys.get(roomId) ?? hostKeys()[roomId];
}

export function rememberHostKey(roomId: string, key: string): void {
  memoryHostKeys.set(roomId, key);
  write(HOST_KEYS, JSON.stringify({ ...hostKeys(), [roomId]: key }));
}

/**
 * The host key arrives in the URL fragment: it never goes to the server.
 * We strip it from the browser's address bar right after reading it — on a screen share, everyone can see it.
 */
export function takeHostKeyFromHash(roomId: string): void {
  const match = window.location.hash.match(/^#host=([A-Za-z0-9_-]{22})$/);
  if (match?.[1] === undefined) return;
  rememberHostKey(roomId, match[1]);
  window.history.replaceState(null, '', window.location.pathname);
}

export function createRoom(): { roomId: string; hostKey: string } {
  const roomId = generateId();
  const hostKey = generateId();
  rememberHostKey(roomId, hostKey);
  return { roomId, hostKey };
}

export function inviteLink(roomId: string): string {
  return `${window.location.origin}/r/${roomId}`;
}

export function hostLink(roomId: string, hostKey: string): string {
  return `${inviteLink(roomId)}#host=${hostKey}`;
}
