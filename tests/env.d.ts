import type { D1Migration } from '@cloudflare/vitest-plugin';
declare module 'cloudflare:test' { interface ProvidedEnv extends Env { TEST_MIGRATIONS:D1Migration[]; } }
