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
    // Приватное окно или запрет на хранилище: играть это не мешает.
  }
}

/** Постоянный идентификатор игрока. Это секрет сессии, наружу он не уходит. */
export function playerId(): string {
  const stored = read(PLAYER_ID);
  if (stored !== null && isId(stored)) return stored;
  const created = generateId();
  write(PLAYER_ID, created);
  return created;
}

export function savedName(): string {
  return read(NAME) ?? '';
}

export function saveName(name: string): void {
  write(NAME, name);
}

/** `/r/<roomId>` — сама ссылка и есть приглашение. */
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
  return hostKeys()[roomId];
}

export function rememberHostKey(roomId: string, key: string): void {
  write(HOST_KEYS, JSON.stringify({ ...hostKeys(), [roomId]: key }));
}

/**
 * Ключ хоста приходит во фрагменте адреса: он не уходит на сервер.
 * Сразу после чтения стираем его из строки браузера — на дейли экран показывают всем.
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
