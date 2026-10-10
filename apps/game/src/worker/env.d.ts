// Not in wrangler.jsonc, so `wrangler types` does not know them: production runs the defaults
// in code, and only the test bindings in vitest.config.ts shorten a round.
interface Env {
  COUNTDOWN_MS?: string;
  ROUND_MS?: string;
}
