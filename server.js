const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const TRIPS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "trips.json"), "utf-8"));

const ROUTE_NAMES = {
  S6: "Novara–Milano Passante–Treviglio",
  R27: "Novara–Saronno–Milano",
  R25: "Novara–Mortara",
};

// ViaggiaTreno/RFI espone in tempo reale partenze, arrivi e ritardi.
// I codici stazione usati qui sono quelli presenti anche nel GTFS del progetto.
const LIVE_STATIONS = {
  NOVARA: "S00248",
  NOVARA_NORD: "S00023",
  MORTARA: "S00034",
};
const LIVE_POLL_MS = 30000;
const LIVE_MATCH_WINDOW_MIN = 4;

let realtime = {
  updatedAt: null,
  available: false,
  source: "ViaggiaTreno / RFI realtime",
  trains: [],
  error: null,
};

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function prepareTrip(trip) {
  const stops = trip.stops;
  let cum = 0;
  const cumDist = [0];
  for (let i = 1; i < stops.length; i++) {
    cum += haversine(stops[i - 1].lat, stops[i - 1].lon, stops[i].lat, stops[i].lon);
    cumDist.push(cum);
  }
  return { ...trip, cumDist, totalDist: cum };
}

const PREPARED_TRIPS = TRIPS.map(prepareTrip);

function nowMinutes(overrideHHMM) {
  if (overrideHHMM && /^\d{1,2}:\d{2}$/.test(overrideHHMM)) {
    const [h, m] = overrideHHMM.split(":").map(Number);
    return h * 60 + m;
  }
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function estimatePosition(trip, nowMin, delayMin = 0) {
  const first = trip.stops[0];
  const last = trip.stops[trip.stops.length - 1];
  const depMin = trip.stops[0].dep_min + delayMin;
  const arrMin = trip.stops[trip.stops.length - 1].arr_min + delayMin;

  if (nowMin < depMin - 5 || nowMin > arrMin + 5) return null;

  if (nowMin <= depMin) {
    return { status: "not_departed", lat: first.lat, lon: first.lon, nextStop: first.name, etaMin: Math.max(0, Math.round(depMin - nowMin)) };
  }
  if (nowMin >= arrMin) {
    return { status: "arrived", lat: last.lat, lon: last.lon, nextStop: null, etaMin: 0 };
  }

  const stops = trip.stops;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const aDep = a.dep_min + delayMin;
    const bArr = b.arr_min + delayMin;
    if (nowMin >= aDep && nowMin <= bArr) {
      const span = bArr - aDep || 1;
      const t = (nowMin - aDep) / span;
      return {
        status: "running",
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        fromStop: a.name,
        nextStop: b.name,
        etaMin: Math.max(0, Math.round(bArr - nowMin)),
        progress: Math.round(t * 100),
      };
    }
  }
  return null;
}

function toTimestamp(value) {
  if (value == null) return null;
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  const n = Number(value);
  if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function extractDelay(item) {
  const candidates = [item?.ritardo, item?.delay, item?.ritardoArrivo, item?.ritardoPartenza];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Math.max(0, Math.round(Number(value)));
  }
  return 0;
}

function itemScheduledTimestamp(item, mode) {
  const keys = mode === "arrivi"
    ? ["orarioArrivo", "orarioArrivoZero", "programmata", "arrivoTeorico"]
    : ["orarioPartenza", "orarioPartenzaZero", "programmata", "partenzaTeorica"];
  for (const key of keys) {
    const ts = toTimestamp(item?.[key]);
    if (ts) return ts;
  }
  return null;
}

function tripStationForRoute(trip) {
  if (trip.route === "R27") return LIVE_STATIONS.NOVARA_NORD;
  if (trip.route === "R25") return LIVE_STATIONS.MORTARA;
  return LIVE_STATIONS.NOVARA;
}

function targetTimeForTrip(trip, mode) {
  const d = new Date();
  const time = mode === "arrivi" ? trip.stops[trip.stops.length - 1].arr_min : trip.stops[0].dep_min;
  const h = Math.floor(time / 60) % 24;
  const m = Math.floor(time % 60);
  const s = Math.floor((time % 1) * 60);
  d.setHours(h, m, s, 0);
  return d.getTime();
}

function stationRequestDate() {
  // ViaggiaTreno accetta una data/ora locale in formato Date.toString().
  return encodeURIComponent(new Date().toString());
}

async function fetchStation(mode, stationCode) {
  const url = `https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/${mode}/${stationCode}/${stationRequestDate()}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`ViaggiaTreno ${mode} ${stationCode}: HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function refreshRealtime() {
  try {
    const stations = [...new Set(Object.values(LIVE_STATIONS))];
    const requests = [];
    for (const code of stations) {
      requests.push(fetchStation("partenze", code).then(items => ({ mode: "partenze", code, items })));
      requests.push(fetchStation("arrivi", code).then(items => ({ mode: "arrivi", code, items })));
    }
    const results = await Promise.all(requests);
    const live = [];

    for (const { mode, code, items } of results) {
      for (const item of items) {
        const number = String(item?.numeroTreno ?? item?.numero ?? "").trim();
        const scheduled = itemScheduledTimestamp(item, mode);
        if (!number || !scheduled) continue;
        live.push({
          number,
          mode,
          station: code,
          scheduled,
          delayMin: extractDelay(item),
          destination: item?.destinazione ?? null,
          origin: item?.origine ?? null,
          operator: item?.codiceCliente ?? null,
          cancelled: Boolean(item?.soppresso || item?.soppressione || item?.tipoTreno === "ST"),
        });
      }
    }

    realtime = {
      updatedAt: new Date().toISOString(),
      available: true,
      source: "ViaggiaTreno / RFI realtime",
      trains: live,
      error: null,
    };
    console.log(`Realtime aggiornato: ${live.length} record`);
  } catch (error) {
    realtime = { ...realtime, available: false, error: error.message };
    console.error("Realtime non disponibile:", error.message);
  }
}

function findRealtimeForTrip(trip) {
  const station = tripStationForRoute(trip);
  const depStation = trip.stops[0].id === station ? station : null;
  const arrStation = trip.stops[trip.stops.length - 1].id === station ? station : null;
  const modes = [];
  if (depStation) modes.push("partenze");
  if (arrStation) modes.push("arrivi");
  // Se l'estratto GTFS ha una fermata leggermente diversa, proviamo entrambi i versi.
  if (!modes.length) modes.push("partenze", "arrivi");

  const targetTimes = modes.map(mode => ({ mode, target: targetTimeForTrip(trip, mode) }));
  let best = null;
  for (const { mode, target } of targetTimes) {
    for (const item of realtime.trains) {
      if (item.station !== station || item.mode !== mode) continue;
      const diff = Math.abs(item.scheduled - target) / 60000;
      if (diff > LIVE_MATCH_WINDOW_MIN) continue;
      if (best === null || diff < best.diff) best = { ...item, diff };
    }
  }
  return best;
}

app.get("/api/trains", (req, res) => {
  const nowMin = nowMinutes(req.query.at);
  const trains = [];

  for (const trip of PREPARED_TRIPS) {
    const live = !req.query.at ? findRealtimeForTrip(trip) : null;
    const delayMin = live?.delayMin ?? 0;
    const pos = estimatePosition(trip, nowMin, delayMin);
    if (!pos) continue;

    trains.push({
      trip_id: trip.trip_id,
      route: trip.route,
      route_name: ROUTE_NAMES[trip.route] || trip.route,
      dep: trip.dep,
      arr: trip.arr,
      origin: trip.stops[0].name,
      destination: trip.stops[trip.stops.length - 1].name,
      delay_min: delayMin,
      delay_status: delayMin < 5 ? "on_time" : delayMin <= 30 ? "delayed" : "severe_delay",
      realtime: Boolean(live),
      realtime_train_number: live?.number ?? null,
      realtime_updated_at: realtime.updatedAt,
      realtime_operator: live?.operator ?? null,
      cancelled: live?.cancelled ?? false,
      ...pos,
    });
  }

  res.json({
    generated_at: new Date().toISOString(),
    reference_minutes: Math.round(nowMin),
    source: realtime.available ? "Trenord GTFS static + ViaggiaTreno/RFI realtime" : "Trenord GTFS static (realtime temporaneamente non disponibile)",
    realtime_available: realtime.available,
    realtime_updated_at: realtime.updatedAt,
    count: trains.length,
    trains,
  });
});

app.get("/api/realtime-status", (req, res) => {
  res.json({ available: realtime.available, updated_at: realtime.updatedAt, source: realtime.source, record_count: realtime.trains.length, error: realtime.error });
});

app.get("/api/routes", (req, res) => {
  res.json(Object.entries(ROUTE_NAMES).map(([id, name]) => ({ id, name })));
});

app.get("/", (req, res) => {
  res.json({
    service: "TrainRadar24 API — zona Novara",
    endpoints: ["/api/trains", "/api/realtime-status", "/api/routes"],
    note: "Orari e geometrie da GTFS Trenord; ritardi realtime da ViaggiaTreno/RFI quando disponibili.",
  });
});

app.listen(PORT, () => {
  console.log(`TrainRadar24 backend attivo su porta ${PORT}`);
  console.log(`Corse caricate: ${PREPARED_TRIPS.length}`);
  refreshRealtime();
  setInterval(refreshRealtime, LIVE_POLL_MS);
});
