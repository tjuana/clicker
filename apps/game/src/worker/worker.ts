import { isId } from '@clicker/protocol';
import { routePartykitRequest } from 'partyserver';
import { Room } from './room';

export { Room };

const notFound = (): Response => new Response('Not found', { status: 404 });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routePartykitRequest(request, env, {
      onBeforeConnect: (_request, lobby) => (isId(lobby.name) ? undefined : notFound()),
      onBeforeRequest: (_request, lobby) => (isId(lobby.name) ? undefined : notFound()),
    });

    return response ?? notFound();
  },
};
