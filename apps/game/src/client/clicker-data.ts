import type { SnapshotMessage } from '@clicker/protocol';

/** The clicker's slot of a snapshot. */
export type ClickerData = Extract<SnapshotMessage, { mode: 'clicker' }>['data'];

const NO_DATA: ClickerData = { scores: {}, results: null };

/**
 * The clicker screens draw the clicker's data. Outside the clicker there is none, and an empty
 * slot keeps them from reading another mode's fields as if they were scores.
 */
export function clickerData(snapshot: SnapshotMessage): ClickerData {
  return snapshot.mode === 'clicker' ? snapshot.data : NO_DATA;
}
