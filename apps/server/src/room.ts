import { Server } from 'partyserver';

export class Room extends Server<Env> {
  static options = { hibernate: true };
}
