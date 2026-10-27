/**
 * The mask the player wants, kept apart from what reached the server. The mask is sent only when
 * it changes, and the room forgets it when a connection rejoins (the car's keys go to 0), so a
 * change made while the socket was closed, or a key held across the reconnect, is lost unless it is
 * said again once the room has welcomed the connection back.
 */
export function createHeldKeys(send: (mask: number) => boolean): {
  /** Remembers the mask even when it could not be sent. */
  set: (mask: number) => void;
  /** After a welcome: the room holds 0, so only a held key needs saying. */
  resend: () => void;
} {
  let wanted = 0;
  return {
    set: (mask) => {
      wanted = mask;
      send(mask);
    },
    resend: () => {
      if (wanted !== 0) send(wanted);
    },
  };
}
