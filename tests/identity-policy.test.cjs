const { test } = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../src/shared/service-schedule.json');
const { normalizeIdentityMode, servicePhase, identityPresentation, canSkipIdentity } = require('../desktop/identity-policy.cjs');

const at = local => new Date(`${local}-07:00`);
const presentation = (local, extra = {}) => identityPresentation({ platform: 'win32', mode: 'before-service', at: at(local), ...extra });

test('identity modes default safely and preserve the two alternatives', () => {
  for (const value of [undefined, null, '', 'fullscreen', {}, 0]) assert.equal(normalizeIdentityMode(value), 'before-service');
  for (const value of ['before-service', 'in-app', 'off']) assert.equal(normalizeIdentityMode(value), value);
});

test('startup identity is desktop-wide outside service and the after-service period', () => {
  const cases = [
    ['2026-10-18T07:59:59.999', 'outside', 'fullscreen'],
    ['2026-10-18T08:00:00.000', 'before', 'fullscreen'],
    ['2026-10-18T09:59:59.999', 'before', 'fullscreen'],
    ['2026-10-18T10:00:00.000', 'during', 'window'],
    ['2026-10-18T11:59:59.999', 'during', 'window'],
    ['2026-10-18T12:00:00.000', 'after', 'window'],
    ['2026-10-18T13:59:59.999', 'after', 'window'],
    ['2026-10-18T14:00:00.000', 'outside', 'fullscreen'],
  ];
  for (const [local, phase, expected] of cases) {
    assert.equal(servicePhase(at(local)).phase, phase, local);
    assert.equal(presentation(local), expected, local);
  }
  assert.deepEqual(servicePhase(at('2026-10-18T09:00:00')), {
    phase: 'before', serviceStartsAt: at('2026-10-18T10:00:00').getTime(), serviceEndsAt: at('2026-10-18T12:00:00').getTime(),
  });
});

test('Sunday evening, Tuesday, and Thursday each use their saved schedule', () => {
  for (const [date, start, end] of [['2026-10-18', 18, 20], ['2026-10-20', 19, 21], ['2026-10-22', 19, 21]]) {
    assert.equal(servicePhase(at(`${date}T${start - 2}:00:00`)).phase, 'before');
    assert.equal(presentation(`${date}T${start - 1}:00:00`), 'fullscreen');
    assert.equal(servicePhase(at(`${date}T${start}:00:00`)).phase, 'during');
    assert.equal(presentation(`${date}T${start}:00:00`), 'window');
    assert.equal(servicePhase(at(`${date}T${end}:00:00`)).phase, 'after');
    assert.equal(presentation(`${date}T${end}:00:00`), 'window');
  }
  assert.equal(servicePhase(at('2026-10-19T17:30:00')).phase, 'outside');assert.equal(presentation('2026-10-19T17:30:00'),'fullscreen');
  assert.equal(servicePhase(at('2026-10-21T17:30:00')).phase, 'outside');
});

test('Phoenix evening services retain the local weekday across UTC midnight', () => {
  assert.equal(servicePhase(new Date('2026-10-21T00:00:00Z')).phase, 'before'); // Tuesday 17:00
  assert.equal(servicePhase(new Date('2026-10-21T02:00:00Z')).phase, 'during'); // Tuesday 19:00
  assert.equal(servicePhase(new Date('2026-10-21T04:00:00Z')).phase, 'after'); // Tuesday 21:00
  assert.equal(servicePhase(new Date('2026-10-21T06:00:00Z')).phase, 'outside'); // Tuesday 23:00
});

test('a service crossing local midnight includes the adjacent local dates', () => {
  const overnight = { ...schedule, services: [{ day: 0, hour: 23, minute: 30 }] };
  assert.equal(servicePhase(at('2026-10-18T21:30:00'), overnight).phase, 'before');
  assert.equal(servicePhase(at('2026-10-19T00:30:00'), overnight).phase, 'during');
  assert.equal(servicePhase(at('2026-10-19T01:30:00'), overnight).phase, 'after');
  assert.equal(servicePhase(at('2026-10-19T03:30:00'), overnight).phase, 'outside');
  const early = { ...schedule, services: [{ day: 1, hour: 0, minute: 30 }] };
  assert.equal(servicePhase(at('2026-10-18T22:30:00'), early).phase, 'before');
});

test('an active service wins an overlapping pre-service window', () => {
  const overlapping = { ...schedule, services: [{ day: 0, hour: 10, minute: 0 }, { day: 0, hour: 12, minute: 30 }] };
  assert.equal(servicePhase(at('2026-10-18T11:00:00'), overlapping).phase, 'during');
  assert.equal(presentation('2026-10-18T11:00:00', { schedule: overlapping }), 'window');
  assert.equal(servicePhase(at('2026-10-18T12:00:00'), overlapping).phase, 'before');
  assert.equal(presentation('2026-10-18T12:00:00', { schedule: overlapping }), 'fullscreen');
});

test('in-app, automatic off, dismissal, and non-Windows platforms always use a window', () => {
  const before = '2026-10-18T09:00:00';
  assert.equal(presentation(before, { mode: 'in-app' }), 'window');
  assert.equal(presentation(before, { mode: 'off' }), 'window');
  assert.equal(presentation(before, { dismissed: true }), 'window');
  for (const platform of ['darwin', 'linux', undefined]) assert.equal(presentation(before, { platform }), 'window');
  assert.equal(identityPresentation(), 'window');
});

test('Windows startup and unlock protect service and post-service times just like Switch User',()=>{
 for(const [local,expected] of [['2026-10-20T18:59:00','fullscreen'],['2026-10-20T19:21:00','window'],['2026-10-20T21:30:00','window']]){
  for(const reason of ['startup','unlock']){
   assert.equal(presentation(local,{reason}),expected,local+' '+reason);
   for(const mode of ['in-app','off'])assert.equal(presentation(local,{reason,mode}),'window');
   assert.equal(presentation(local,{reason,dismissed:true}),'window');
   assert.equal(presentation(local,{reason,platform:'darwin'}),'window');
  }
 }
 assert.equal(presentation('2026-10-20T19:21:00',{reason:'switch'}),'window');
});

test('invalid dates or schedules never create a desktop-wide identity screen', () => {
  const outside = { phase: 'outside', serviceStartsAt: null, serviceEndsAt: null };
  for (const invalid of [new Date(NaN), NaN, Infinity, null, '2026-10-18']) assert.deepEqual(servicePhase(invalid), outside);
  for (const invalid of [null, {}, { ...schedule, timezone: 'America/New_York' }, { ...schedule, durationMinutes: 0 }, { ...schedule, durationMinutes: NaN }, { ...schedule, durationMinutes: 1500 }, { ...schedule, services: null }]) {
    assert.deepEqual(servicePhase(at('2026-10-18T09:00:00'), invalid), outside);
    assert.equal(presentation('2026-10-18T09:00:00', { schedule: invalid }), 'window');
  }
  const malformed = { ...schedule, services: [null, {}, { day: 0, hour: 25, minute: 0 }, { day: 7, hour: 10, minute: 0 }, { day: 0, hour: 10, minute: -1 }, { day: 0, hour: 10, minute: 0.5 }] };
  assert.deepEqual(servicePhase(at('2026-10-18T09:00:00'), malformed), outside);
});

test('Skip for now opens exactly five minutes before each service and closes at the service end',()=>{
 for(const [date,start,end] of [['2026-10-18',10,12],['2026-10-18',18,20],['2026-10-20',19,21],['2026-10-22',19,21]]){
  for(const [local,expected] of [[`${date}T${String(start-1).padStart(2,'0')}:54:59.999`,false],[`${date}T${String(start-1).padStart(2,'0')}:55:00.000`,true],[`${date}T${String(start).padStart(2,'0')}:00:00.000`,true],[`${date}T${String(end-1).padStart(2,'0')}:59:59.999`,true],[`${date}T${String(end).padStart(2,'0')}:00:00.000`,false]])assert.equal(canSkipIdentity(at(local)),expected,local);
 }
 for(const invalid of [new Date(NaN),NaN,Infinity,null,'2026-10-18'])assert.equal(canSkipIdentity(invalid),false);
 for(const invalid of [null,{}, {...schedule,timezone:'Other'}, {...schedule,services:[]}])assert.equal(canSkipIdentity(at('2026-10-20T19:21:00'),invalid),false);
 assert.equal(canSkipIdentity(at('2026-10-21T19:21:00')),false);
 const overnight={...schedule,services:[{day:0,hour:23,minute:30}]};assert.equal(canSkipIdentity(at('2026-10-18T23:25:00'),overnight),true);assert.equal(canSkipIdentity(at('2026-10-19T00:30:00'),overnight),true);assert.equal(canSkipIdentity(at('2026-10-19T01:30:00'),overnight),false);
});
