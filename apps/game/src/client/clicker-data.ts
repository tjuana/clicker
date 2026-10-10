import type { SnapshotMessage } from '@clicker/protocol';

/** The clicker's slot of a snapshot, picked out of the union of every mode's data. */
export type ClickerData = Extract<SnapshotMessage['data'], { scores: unknown }>;

const NO_DATA: ClickerData = { scores: {}, results: null };

/**
 * The clicker screens draw the clicker's data. Outside the clicker there is none, and an empty
 * slot keeps them from reading another mode's fields as if they were scores. The `in` check is
 * what narrows the type: `mode` and `data` are separate fields, so the compiler cannot tie them.
 */
export function clickerData(snapshot: SnapshotMessage): ClickerData {
  const { data } = snapshot;
  return snapshot.mode === 'clicker' && 'scores' in data ? data : NO_DATA;
}
