// TrainRadar24 Piemonte realtime adapter V12.
// ViaggiaTreno remains the source of truth. This adapter keeps the real first/last
// service endpoints, normalizes EuroCity into the IC bucket used by the UI, and
// anchors the map marker to the latest ViaggiaTreno detection when that detection
// is expressed as a signal/railway-location label rather than an exact stop name.
const base = require('./national-loader-v10');

function endpointName(stop) {
  return String(stop?.name || '').trim();
}

function normalized(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function serviceEndpoints(trip) {
  const stops = Array.isArray(trip?.stops) ? trip.stops : [];
  if (!stops.length) return { origin: trip?.origin || '', destination: trip?.destination || '' };

  const first = stops.find(s => s?.tipoFermata === 'P') || stops[0];
  const last = [...stops].reverse().find(s => s?.tipoFermata === 'A') || stops[stops.length - 1];

  let origin = endpointName(first) || String(trip?.origin || '').trim();
  let destination = endpointName(last) || String(trip?.destination || '').trim();

  if (trip?.origin_foreign) origin = String(trip.origin_foreign).trim() || origin;
  if (trip?.destination_foreign) destination = String(trip.destination_foreign).trim() || destination;

  // ViaggiaTreno can expose the foreign endpoint separately from idDestinazione.
  // Keep a timetable-backed fallback only when that field is absent.
  const n = Number(trip?.verified_train_number || trip?.train_number);
  const c = String(trip?.verified_category || trip?.category || '').toUpperCase();
  if (/^EC$/.test(c) && Number.isFinite(n)) {
    const baselToMilan = new Set([61, 63, 65, 67, 173]);
    const milanToBasel = new Set([60, 62, 64, 66, 178]);
    const milanToFrankfurt = new Set([150]);
    const frankfurtToMilan = new Set([151]);
    if (!trip?.destination_foreign && milanToBasel.has(n)) destination = 'BASEL SBB';
    if (!trip?.origin_foreign && baselToMilan.has(n)) origin = 'BASEL SBB';
    if (!trip?.destination_foreign && milanToFrankfurt.has(n)) destination = 'FRANKFURT(MAIN)HBF';
    if (!trip?.origin_foreign && frankfurtToMilan.has(n)) origin = 'FRANKFURT(MAIN)HBF';
  }

  return { origin, destination };
}

function normalizeCategory(trip) {
  const raw = String(trip?.verified_category || trip?.category || '').toUpperCase().trim();
  // The UI has an IC bucket for intercity/international conventional services.
  // EuroCity remains identified by the raw ViaggiaTreno fields, but is displayed in IC.
  if (raw === 'EC' || raw === 'EIC' || raw === 'IC2' || raw === 'EN') return 'IC';
  return raw || 'REG';
}

function detectionStop(trip) {
  const text = normalized(trip?.last_detection_station);
  if (!text) return null;
  const stops = Array.isArray(trip?.stops) ? trip.stops : [];
  let best = null;
  let bestScore = 0;
  for (const stop of stops) {
    const name = normalized(stop?.name);
    if (!name) continue;
    if (name === text) return stop;
    let score = 0;
    if (text.includes(name) || name.includes(text)) score += 100;
    const a = new Set(text.split(/\s+/).filter(Boolean));
    const b = new Set(name.split(/\s+/).filter(Boolean));
    for (const token of b) {
      if (token.length >= 3 && a.has(token)) score += 12;
    }
    // ViaggiaTreno frequently reports locations such as "SEGNALE DI CONFINE RHO".
    // Match the meaningful railway/station token against the actual stop.
    if (/\bRHO\b/.test(text) && /\bRHO\b/.test(name)) score += 40;
    if (score > bestScore && Number.isFinite(Number(stop?.lat)) && Number.isFinite(Number(stop?.lon))) {
      bestScore = score;
      best = stop;
    }
  }
  return bestScore >= 12 ? best : null;
}

function fixLastDetectionPosition(trip) {
  const stop = detectionStop(trip);
  if (!stop) return trip;
  const lat = Number(stop.lat);
  const lon = Number(stop.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return trip;
  return {
    ...trip,
    lat,
    lon,
    position_source: 'ViaggiaTreno · ultimo rilevamento',
    position_station_match: stop.name,
    // The marker represents the last verified railway detection, not a speculative
    // straight-line interpolation to a future station.
    status: trip.status === 'not_departed' ? trip.status : 'running',
    nextStop: trip.nextStop || stop.name,
  };
}

function fixTrip(trip) {
  const { origin, destination } = serviceEndpoints(trip);
  const category = normalizeCategory(trip);
  let fixed = {
    ...trip,
    origin: origin || trip.origin,
    destination: destination || trip.destination,
    category,
    verified_category: category,
    service_category: category,
    category_group: category === 'IC' ? 'IC' : trip.category_group,
    route_name: `${origin || trip.origin} → ${destination || trip.destination}`,
  };
  fixed = fixLastDetectionPosition(fixed);
  return fixed;
}

async function load() {
  const payload = await base.load();
  return { ...payload, trips: (payload.trips || []).map(fixTrip) };
}

module.exports = { ...base, load, realtime: load };
