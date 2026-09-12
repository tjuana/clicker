import { comparePublicIds, type RoomState } from '@clicker/game';
import * as v from 'valibot';
import { MAX_MESSAGE_BYTES } from './client';

const phaseSchema = v.picklist(['lobby', 'countdown', 'running', 'results']);

const errorCodeSchema = v.picklist([
  'not_joined',
  'not_host',
  'wrong_phase',
  'room_full',
  'invalid_message',
]);

export const welcomeSchema = v.strictObject({
  type: v.literal('welcome'),
  you: v.string(),
  isHost: v.boolean(),
});

export const snapshotSchema = v.strictObject({
  type: v.literal('snapshot'),
  serverNow: v.number(),
  phase: phaseSchema,
  players: v.array(
    v.strictObject({
      id: v.string(),
      name: v.string(),
      clicks: v.number(),
      connected: v.boolean(),
    }),
  ),
  round: v.nullable(v.strictObject({ goAt: v.number(), endsAt: v.number() })),
  results: v.nullable(
    v.array(
      v.strictObject({
        id: v.string(),
        name: v.string(),
        clicks: v.number(),
        rank: v.number(),
      }),
    ),
  ),
  notice: v.nullable(v.literal('round_aborted')),
});

export const errorSchema = v.strictObject({
  type: v.literal('error'),
  code: errorCodeSchema,
});

export const serverMessageSchema = v.variant('type', [welcomeSchema, snapshotSchema, errorSchema]);

export type ServerMessage = v.InferOutput<typeof serverMessageSchema>;
export type SnapshotMessage = v.InferOutput<typeof snapshotSchema>;
export type ServerErrorCode = v.InferOutput<typeof errorCodeSchema>;

export function parseServerMessage(raw: string): ServerMessage | null {
  if (new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES * 64) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = v.safeParse(serverMessageSchema, data);
  return result.success ? result.output : null;
}

/** Секретные playerId и hostKey наружу не попадают. */
export function toSnapshot(state: RoomState, now: number): SnapshotMessage {
  return {
    type: 'snapshot',
    serverNow: now,
    phase: state.phase,
    players: Object.values(state.players)
      .map((player) => ({
        id: player.publicId,
        name: player.name,
        clicks: player.clicks,
        connected: player.connectionIds.length > 0,
      }))
      .sort((a, b) => comparePublicIds(a.id, b.id)),
    round: state.round === null ? null : { goAt: state.round.goAt, endsAt: state.round.endsAt },
    results:
      state.results === null
        ? null
        : state.results.map((row) => ({
            id: row.publicId,
            name: row.name,
            clicks: row.clicks,
            rank: row.rank,
          })),
    notice: state.notice,
  };
}
