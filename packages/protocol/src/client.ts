import * as v from 'valibot';
import { ID_PATTERN } from './ids';

/** Всё, что длиннее, до разбора не доходит. */
export const MAX_MESSAGE_BYTES = 1024;
export const MAX_NAME_LENGTH = 20;

const encoder = new TextEncoder();

const idSchema = v.pipe(v.string(), v.regex(ID_PATTERN));

/** Управляющие символы и знаки смены направления письма (U+202A–U+202E, U+2066–U+2069). */
const FORBIDDEN_NAME_CHARS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

/** Ник хранится обрезанным, длина считается в code points. */
const nameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.check((value) => {
    const length = [...value].length;
    return length >= 1 && length <= MAX_NAME_LENGTH;
  }, 'name must be 1..20 characters'),
  v.check((value) => !FORBIDDEN_NAME_CHARS.test(value), 'name must not contain control characters'),
);

export const joinSchema = v.strictObject({
  type: v.literal('join'),
  playerId: idSchema,
  name: nameSchema,
  hostKey: v.optional(idSchema),
});

export const startSchema = v.strictObject({ type: v.literal('start') });

export const clickSchema = v.strictObject({ type: v.literal('click') });

export const clientMessageSchema = v.variant('type', [joinSchema, startSchema, clickSchema]);

export type ClientMessage = v.InferOutput<typeof clientMessageSchema>;
export type JoinMessage = v.InferOutput<typeof joinSchema>;

export function parseClientMessage(raw: string): ClientMessage | null {
  // UTF-8 занимает не меньше байт, чем UTF-16 — единиц; это дешёвый способ отсеять
  // заведомо большие сообщения, не выделяя память под их байтовое представление.
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  if (encoder.encode(raw).length > MAX_MESSAGE_BYTES) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = v.safeParse(clientMessageSchema, data);
  return result.success ? result.output : null;
}
