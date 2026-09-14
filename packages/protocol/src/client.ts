import * as v from 'valibot';
import { ID_PATTERN } from './ids';

/** Anything longer never reaches the parser. */
export const MAX_MESSAGE_BYTES = 1024;
export const MAX_NAME_LENGTH = 20;
/** Bumped when the wire format changes in a way an old client cannot read. */
export const PROTOCOL_VERSION = 1;

const encoder = new TextEncoder();

const idSchema = v.pipe(v.string(), v.regex(ID_PATTERN));
const versionSchema = v.literal(PROTOCOL_VERSION);

/** Control characters and bidi overrides (U+202A–U+202E, U+2066–U+2069). */
const FORBIDDEN_NAME_CHARS = /[\p{Cc}‪-‮⁦-⁩]/u;

/** The name is stored trimmed and its length is counted in code points. */
const nameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.check((value) => {
    const length = [...value].length;
    return length >= 1 && length <= MAX_NAME_LENGTH;
  }, 'name must be 1..20 characters'),
  v.check((value) => !FORBIDDEN_NAME_CHARS.test(value), 'name must not contain control characters'),
);

/** The clicker's input. What it means is the mode's business, not the room's. */
export const clickerInputSchema = v.strictObject({ type: v.literal('click') });

export const joinSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('join'),
  playerId: idSchema,
  name: nameSchema,
  hostKey: v.optional(idSchema),
});

export const startSchema = v.strictObject({ v: versionSchema, type: v.literal('start') });

export const inputSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('input'),
  input: clickerInputSchema,
});

export const clientMessageSchema = v.variant('type', [joinSchema, startSchema, inputSchema]);

export type ClientMessage = v.InferOutput<typeof clientMessageSchema>;
export type JoinMessage = v.InferOutput<typeof joinSchema>;

/**
 * A wrong version is worth telling apart from garbage: the player only needs to reload,
 * and the server can say so instead of silently ignoring them.
 */
export type ParsedClientMessage =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: 'invalid_message' | 'bad_version' };

export function parseClientMessage(raw: string): ParsedClientMessage {
  // UTF-8 is never shorter than UTF-16 in units, so this rejects the huge frames for free.
  if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, reason: 'invalid_message' };
  if (encoder.encode(raw).length > MAX_MESSAGE_BYTES)
    return { ok: false, reason: 'invalid_message' };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_message' };
  }

  const result = v.safeParse(clientMessageSchema, data);
  if (result.success) return { ok: true, message: result.output };

  // Shaped like one of ours but from another build: worth a clear answer.
  const version = (data as { v?: unknown } | null)?.v;
  if (typeof version === 'number' && version !== PROTOCOL_VERSION) {
    return { ok: false, reason: 'bad_version' };
  }
  return { ok: false, reason: 'invalid_message' };
}
