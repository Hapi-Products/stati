import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
export default defineConfig({ plugins: [cloudflareTest({wrangler:{configPath:'./wrangler.jsonc'},miniflare:{bindings:{
 ENROLLMENT_SECRET:'1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', // gitleaks:allow -- fixed synthetic local-test key, never used for deployment
 TEST_MIGRATIONS:await readD1Migrations('./migrations')
}}})],test:{setupFiles:['./tests/setup.ts'],include:['tests/**/*.test.ts'],fileParallelism:false} });
