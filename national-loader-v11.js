// TrainRadar24 Piemonte realtime adapter V11.
// ViaggiaTreno remains the source of truth. The base scanner already performs
// the geographic Piemonte visibility test; this adapter fixes service
// endpoints using the actual first/last stop and rejects route labels that
// are merely the current intermediate station.
const base = require('./national-loader-v10');

function endpointName(stop) {
  return String(stop?.name || '').trim();
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

  return { origin, destination };
}

function fixTrip(trip) {
  const { origin, destination } = serviceEndpoints(trip);
  if (!origin && !destination) return trip;
  return {
    ...trip,
    origin: origin || trip.origin,
    destination: destination || trip.destination,
    route_name: `${origin || trip.origin} → ${destination || trip.destination}`,
  };
}

async function load() {
  const payload = await base.load();
  return { ...payload, trips: (payload.trips || []).map(fixTrip) };
}

module.exports = { ...base, load, realtime: load };
