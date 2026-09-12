import { describe, expect, it, vi } from 'vitest';
import { MAX_MESSAGE_BYTES, parseClientMessage } from '../src/client';
import { generateId } from '../src/ids';

const playerId = generateId();
const hostKey = generateId();

function encode(value: unknown): string {
  return JSON.stringify(value);
}

describe('parseClientMessage', () => {
  it('accepts join with a host key', () => {
    const raw = encode({ type: 'join', playerId, name: 'Аня', hostKey });

    expect(parseClientMessage(raw)).toEqual({ type: 'join', playerId, name: 'Аня', hostKey });
  });

  it('accepts join without a host key', () => {
    const raw = encode({ type: 'join', playerId, name: 'Аня' });

    expect(parseClientMessage(raw)).toEqual({ type: 'join', playerId, name: 'Аня' });
  });

  it('trims the name', () => {
    const raw = encode({ type: 'join', playerId, name: '   Аня   ' });

    expect(parseClientMessage(raw)).toEqual({ type: 'join', playerId, name: 'Аня' });
  });

  it('accepts start and click', () => {
    expect(parseClientMessage(encode({ type: 'start' }))).toEqual({ type: 'start' });
    expect(parseClientMessage(encode({ type: 'click' }))).toEqual({ type: 'click' });
  });

  it('measures the name in code points, not in UTF-16 units', () => {
    const name = '😀'.repeat(11); // 11 символов, но 22 единицы UTF-16

    expect(parseClientMessage(encode({ type: 'join', playerId, name }))).not.toBeNull();
  });

  it('rejects an empty name', () => {
    expect(parseClientMessage(encode({ type: 'join', playerId, name: '   ' }))).toBeNull();
  });

  it('rejects a name longer than 20 characters', () => {
    expect(parseClientMessage(encode({ type: 'join', playerId, name: 'a'.repeat(21) }))).toBeNull();
  });

  it('rejects a malformed player id', () => {
    expect(parseClientMessage(encode({ type: 'join', playerId: 'nope', name: 'Аня' }))).toBeNull();
  });

  it('rejects unknown fields', () => {
    expect(parseClientMessage(encode({ type: 'click', extra: 1 }))).toBeNull();
  });

  it('rejects an unknown message type', () => {
    expect(parseClientMessage(encode({ type: 'kick', playerId }))).toBeNull();
  });

  it('rejects broken json', () => {
    expect(parseClientMessage('{')).toBeNull();
  });

  it('rejects an oversized message before parsing it', () => {
    const raw = `"${'x'.repeat(MAX_MESSAGE_BYTES)}"`;

    expect(parseClientMessage(raw)).toBeNull();
  });

  it('rejects a message that fits in UTF-16 units but is over the byte limit', () => {
    // 513 единиц UTF-16, но 1026 байт в UTF-8: предел считает байты, а не символы.
    const raw = 'я'.repeat(513);

    expect(raw.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(raw)).toBeNull();
  });

  it('rejects an oversized frame without calling JSON.parse, but still parses a small malformed frame', () => {
    const parseSpy = vi.spyOn(JSON, 'parse');

    try {
      const oversized = 'x'.repeat(MAX_MESSAGE_BYTES + 1);
      expect(parseClientMessage(oversized)).toBeNull();
      expect(parseSpy).not.toHaveBeenCalled();

      expect(parseClientMessage('{')).toBeNull();
      expect(parseSpy).toHaveBeenCalled();
    } finally {
      parseSpy.mockRestore();
    }
  });
});
