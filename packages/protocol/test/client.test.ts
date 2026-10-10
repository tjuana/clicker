import { describe, expect, it, vi } from 'vitest';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, parseClientMessage } from '../src/client';
import { generateId } from '../src/ids';

const playerId = generateId();
const hostKey = generateId();

function encode(value: unknown): string {
  return JSON.stringify(value);
}

describe('parseClientMessage', () => {
  it('accepts join with a host key', () => {
    const raw = encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name: 'Аня', hostKey });

    expect(parseClientMessage(raw)).toEqual({
      ok: true,
      message: { v: PROTOCOL_VERSION, type: 'join', playerId, name: 'Аня', hostKey },
    });
  });

  it('accepts join without a host key', () => {
    const raw = encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name: 'Аня' });

    expect(parseClientMessage(raw)).toEqual({
      ok: true,
      message: { v: PROTOCOL_VERSION, type: 'join', playerId, name: 'Аня' },
    });
  });

  it('trims the name', () => {
    const raw = encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name: '   Аня   ' });

    expect(parseClientMessage(raw)).toEqual({
      ok: true,
      message: { v: PROTOCOL_VERSION, type: 'join', playerId, name: 'Аня' },
    });
  });

  it('accepts start and input', () => {
    expect(parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'start' }))).toEqual({
      ok: true,
      message: { v: PROTOCOL_VERSION, type: 'start' },
    });
    expect(
      parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'input', input: { type: 'click' } })),
    ).toEqual({
      ok: true,
      message: { v: PROTOCOL_VERSION, type: 'input', input: { type: 'click' } },
    });
  });

  it('measures the name in code points, not in UTF-16 units', () => {
    const name = '😀'.repeat(11); // 11 characters, but 22 UTF-16 units

    expect(
      parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name })).ok,
    ).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(
      parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name: '   ' })),
    ).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('rejects a name longer than 20 characters', () => {
    expect(
      parseClientMessage(
        encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name: 'a'.repeat(21) }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('rejects a name containing a newline', () => {
    expect(
      parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name: 'A\nB' })),
    ).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('rejects a name containing a NUL byte', () => {
    expect(
      parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name: 'A\u0000B' })),
    ).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('rejects a name containing a right-to-left override', () => {
    expect(
      parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name: 'A\u202eB' })),
    ).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('accepts a plain name', () => {
    expect(
      parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name: 'Alice' })).ok,
    ).toBe(true);
  });

  it('accepts a ZWJ emoji sequence in a name', () => {
    const name = '👨‍👩‍👧';

    expect(
      parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'join', playerId, name })).ok,
    ).toBe(true);
  });

  it('rejects a malformed player id', () => {
    expect(
      parseClientMessage(
        encode({ v: PROTOCOL_VERSION, type: 'join', playerId: 'nope', name: 'Аня' }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('rejects unknown fields', () => {
    expect(
      parseClientMessage(
        encode({ v: PROTOCOL_VERSION, type: 'input', input: { type: 'click' }, extra: 1 }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('rejects an unknown message type', () => {
    expect(parseClientMessage(encode({ v: PROTOCOL_VERSION, type: 'kick', playerId }))).toEqual({
      ok: false,
      reason: 'invalid_message',
    });
  });

  it('rejects broken json', () => {
    expect(parseClientMessage('{')).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('rejects an oversized message before parsing it', () => {
    const raw = `"${'x'.repeat(MAX_MESSAGE_BYTES)}"`;

    expect(parseClientMessage(raw)).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('rejects a message that fits in UTF-16 units but is over the byte limit', () => {
    // 513 UTF-16 units, but 1026 bytes in UTF-8: the limit counts bytes, not characters.
    const raw = 'я'.repeat(513);

    expect(raw.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(raw)).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('rejects an oversized frame without calling JSON.parse, but still parses a small malformed frame', () => {
    const parseSpy = vi.spyOn(JSON, 'parse');

    try {
      const oversized = 'x'.repeat(MAX_MESSAGE_BYTES + 1);
      expect(parseClientMessage(oversized)).toEqual({ ok: false, reason: 'invalid_message' });
      expect(parseSpy).not.toHaveBeenCalled();

      expect(parseClientMessage('{')).toEqual({ ok: false, reason: 'invalid_message' });
      expect(parseSpy).toHaveBeenCalled();
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('rejects a message with a mismatched protocol version', () => {
    const raw = encode({ v: PROTOCOL_VERSION + 1, type: 'start' });

    expect(parseClientMessage(raw)).toEqual({ ok: false, reason: 'bad_version' });
  });

  // Version 1 had no bot flag in the snapshot: a tab still running that client must be told to
  // reload, because it would otherwise reject every new snapshot and sit on a blank screen.
  it('turns away the clients of version 1', () => {
    const raw = encode({ v: 1, type: 'start' });

    expect(parseClientMessage(raw)).toEqual({ ok: false, reason: 'bad_version' });
  });

  it.each([
    { type: 'setMode', mode: 'cycles' },
    { type: 'setMode', mode: 'clicker' },
    { type: 'addBot' },
    { type: 'removeBot' },
    { type: 'resync' },
    { type: 'input', input: { type: 'turn', side: 'left' } },
    { type: 'input', input: { type: 'turn', side: 'right' } },
    { type: 'input', input: { type: 'boost' } },
  ])('accepts $type', (message) => {
    const sent = { v: PROTOCOL_VERSION, ...message };

    expect(parseClientMessage(encode(sent))).toEqual({ ok: true, message: sent });
  });

  it.each([
    [
      'a turn to a side that does not exist',
      { type: 'input', input: { type: 'turn', side: 'up' } },
    ],
    ['a mode that does not exist', { type: 'setMode', mode: 'chess' }],
    ['a setMode without a mode', { type: 'setMode' }],
    ['an extra field in a boost', { type: 'input', input: { type: 'boost', power: 9 } }],
    ['an extra field in addBot', { type: 'addBot', count: 5 }],
    ['an extra field in resync', { type: 'resync', since: 3 }],
  ])('rejects %s', (_label, message) => {
    expect(parseClientMessage(encode({ v: PROTOCOL_VERSION, ...message }))).toEqual({
      ok: false,
      reason: 'invalid_message',
    });
  });
});
