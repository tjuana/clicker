import { routePartykitRequest } from 'partyserver';
import { Room } from './room';

export { Room };

/** Тот же формат, что у идентификаторов протокола: 16 случайных байт в base64url. */
const ROOM_ID = /^[A-Za-z0-9_-]{22}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routePartykitRequest(request, env, {
      onBeforeConnect: (_request, lobby) =>
        ROOM_ID.test(lobby.name) ? undefined : new Response('Not found', { status: 404 }),
    });

    return response ?? new Response('Not found', { status: 404 });
  },
};
