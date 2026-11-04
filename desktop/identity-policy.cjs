const savedSchedule = require('../src/shared/service-schedule.json');

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PHOENIX_OFFSET = 7 * 60 * MINUTE;
const LEAD = 120 * MINUTE;
const FOLLOW = 120 * MINUTE;
const MODES = new Set(['before-service', 'in-app', 'off']);

function normalizeIdentityMode(value) {
  return MODES.has(value) ? value : 'before-service';
}

function outside() {
  return { phase: 'outside', serviceStartsAt: null, serviceEndsAt: null };
}

function validService(service) {
  return service && Number.isInteger(service.day) && service.day >= 0 && service.day <= 6 &&
    Number.isInteger(service.hour) && service.hour >= 0 && service.hour <= 23 &&
    Number.isInteger(service.minute) && service.minute >= 0 && service.minute <= 59;
}

// This is only the desktop identity presentation policy. Account creation and
// file-sending permissions continue to use the server's existing service rules.
function servicePhase(at = new Date(), schedule = savedSchedule) {
  const time = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : NaN;
  if (!Number.isFinite(time) || !schedule || schedule.timezone !== 'America/Phoenix' ||
      !Number.isFinite(schedule.durationMinutes) || schedule.durationMinutes <= 0 ||
      schedule.durationMinutes > 24 * 60 || !Array.isArray(schedule.services)) return outside();

  // Phoenix stays at UTC-07:00. Work from the local date, including adjacent
  // dates so Sunday evening and late-night services survive UTC midnight.
  const local = new Date(time - PHOENIX_OFFSET);
  const localDay = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const services = [];
  for (let offset = -2; offset <= 1; offset++) {
    const day = localDay + offset * DAY;
    const weekday = new Date(day).getUTCDay();
    for (const service of schedule.services) {
      if (!validService(service) || service.day !== weekday) continue;
      const start = day + PHOENIX_OFFSET + (service.hour * 60 + service.minute) * MINUTE;
      const end = start + schedule.durationMinutes * MINUTE;
      services.push({ start, end });
    }
  }

  // An active service always takes precedence over a later service's lead-in.
  const during = services.filter(({ start, end }) => time >= start && time < end)
    .sort((a, b) => b.start - a.start)[0];
  const before = services.filter(({ start }) => time >= start - LEAD && time < start)
    .sort((a, b) => a.start - b.start)[0];
  const after = services.filter(({ end }) => time >= end && time < end + FOLLOW)
    .sort((a, b) => b.end - a.end)[0];
  const match = during || before || after;
  if (!match) return outside();
  return {
    phase: during ? 'during' : before ? 'before' : 'after',
    serviceStartsAt: match.start,
    serviceEndsAt: match.end,
  };
}

function identityPresentation({ mode, platform, at=new Date(), schedule=savedSchedule, dismissed = false, reason = 'switch' } = {}) {
  if (platform !== 'win32' || normalizeIdentityMode(mode) !== 'before-service' || dismissed) return 'window';
  // Service protection applies to every entry point, including Windows startup
  // and unlock. An identity prompt must not cover an ongoing service.
  const time=at instanceof Date?at.getTime():typeof at==='number'?at:NaN;
  if(!Number.isFinite(time)||!schedule||schedule.timezone!=='America/Phoenix'||!Number.isFinite(schedule.durationMinutes)||schedule.durationMinutes<=0||schedule.durationMinutes>24*60||!Array.isArray(schedule.services)||!schedule.services.some(validService))return 'window';
  const phase=servicePhase(at,schedule).phase;
  return phase==='during'||phase==='after'?'window':'fullscreen';
}

function canSkipIdentity(at = new Date(), schedule = savedSchedule) {
  const time = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : NaN;
  if (!Number.isFinite(time)) return false;
  const service = servicePhase(time, schedule);
  return service.phase === 'during' || service.phase === 'before' &&
    service.serviceStartsAt !== null && time >= service.serviceStartsAt - 5 * MINUTE;
}

module.exports = { normalizeIdentityMode, servicePhase, identityPresentation, canSkipIdentity };
