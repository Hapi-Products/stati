import { env,applyD1Migrations } from 'cloudflare:test';
await applyD1Migrations(env.DB,env.TEST_MIGRATIONS);

import { hash,now } from '../src/server/core';
await env.DB.prepare('INSERT INTO access_grants VALUES(?,?,?)').bind(await hash('isolated-test-access'),now(),now()+86400).run();

import {beforeEach,afterEach,vi} from 'vitest';
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-11T10:15:00-07:00'));});
afterEach(()=>vi.useRealTimers());
