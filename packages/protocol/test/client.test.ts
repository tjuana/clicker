import { describe, expect, it } from 'vitest';
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
});
