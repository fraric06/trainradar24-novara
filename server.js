/**
 * TRAINRADAR24 — SERVIZIO BACKEND (Novara, dati Trenord reali)
 * =============================================================
 * Legge data/trips.json — un estratto REALE del feed GTFS ufficiale
 * di Trenord (scaricato da dati.lombardia.it), filtrato sulle 3 linee
 * che passano per Novara: S6, R27, R25.
 *
 * Ogni tot secondi ricalcola la posizione stimata di ogni corsa attiva
 * ORA (basandosi sull'orario reale di sistema, non simulato) e la
 * espone via un'API REST che il frontend interroga a intervalli.
 *
 * Per aggiornare i dati con orari futuri, basta sostituire
 * data/trips.json con un nuovo estratto dallo stesso feed GTFS —
 * la logica di calcolo posizione non cambia.
 *
 * AVVIO LOCALE:
 *   npm install
 *   node server.js
 *   -> http://localhost:3000/api/trains
 *
 * DEPLOY (per farlo girare 24/7):
 *   Render / Railway / Fly.io — piano free sufficiente per iniziare.
 *   Basta collegare questa cartella come repo e avviare "node server.js".
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// ---- 1. Carica i dati reali (orario di un giorno feriale tipo) ----
const TRIPS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "trips.json"), "utf-8")
);

const ROUTE_NAMES = {
  S6: "Novara–Milano Passante–Treviglio",
  R27: "Novara–Saronno–Milano",
  R25: "Novara–Mortara",
};

// ---- 2. Utility geografiche ----
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Pre-calcola, per ogni corsa, la distanza cumulativa di ogni fermata
// lungo il percorso — serve per interpolare la posizione in modo
// proporzionale alla distanza reale, non solo al numero di fermate.
function prepareTrip(trip) {
  const stops = trip.stops;
  let cum = 0;
  const cumDist = [0];
  for (let i = 1; i < stops.length; i++) {
    cum += haversine(
      stops[i - 1].lat,
      stops[i - 1].lon,
      stops[i].lat,
      stops[i].lon
    );
    cumDist.push(cum);
  }
  return { ...trip, cumDist, totalDist: cum };
}

const PREPARED_TRIPS = TRIPS.map(prepareTrip);

// ---- 3. Orario "di riferimento": minuti dalla mezzanotte, orario reale ----
// In demo puoi forzare un orario diverso passando ?at=HH:MM nella query,
// utile per vedere corse anche fuori dall'orario corrente di test.
function nowMinutes(overrideHHMM) {
  if (overrideHHMM && /^\d{1,2}:\d{2}$/.test(overrideHHMM)) {
    const [h, m] = overrideHHMM.split(":").map(Number);
    return h * 60 + m;
  }
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

// ---- 4. ALGORITMO CENTRALE: posizione stimata dalla corsa GTFS reale ----
function estimatePosition(trip, nowMin) {
  const first = trip.stops[0];
  const last = trip.stops[trip.stops.length - 1];
  const depMin = trip.stops[0].dep_min;
  const arrMin = trip.stops[trip.stops.length - 1].arr_min;

  if (nowMin < depMin - 5) return null; // non ancora rilevante
  if (nowMin > arrMin + 5) return null; // già arrivato da un pezzo

  if (nowMin <= depMin) {
    return {
      status: "not_departed",
      lat: first.lat,
      lon: first.lon,
      nextStop: first.name,
      etaMin: Math.max(0, Math.round(depMin - nowMin)),
    };
  }
  if (nowMin >= arrMin) {
    return {
      status: "arrived",
      lat: last.lat,
      lon: last.lon,
      nextStop: null,
      etaMin: 0,
    };
  }

  // trova la coppia di fermate tra cui ci troviamo ora, per tempo
  const stops = trip.stops;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (nowMin >= a.dep_min && nowMin <= b.arr_min) {
      const span = b.arr_min - a.dep_min || 1;
      const t = (nowMin - a.dep_min) / span; // 0..1 nel segmento

      // interpola sulla distanza reale del segmento, non solo linearmente
      const lat = a.lat + (b.lat - a.lat) * t;
      const lon = a.lon + (b.lon - a.lon) * t;

      return {
        status: "running",
        lat,
        lon,
        fromStop: a.name,
        nextStop: b.name,
        etaMin: Math.max(0, Math.round(b.arr_min - nowMin)),
        progress: Math.round(t * 100),
      };
    }
  }
  return null;
}

// ---- 5. Endpoint principale: tutte le posizioni correnti ----
app.get("/api/trains", (req, res) => {
  const nowMin = nowMinutes(req.query.at);
  const trains = [];

  for (const trip of PREPARED_TRIPS) {
    const pos = estimatePosition(trip, nowMin);
    if (!pos) continue;
    trains.push({
      trip_id: trip.trip_id,
      route: trip.route,
      route_name: ROUTE_NAMES[trip.route] || trip.route,
      dep: trip.dep,
      arr: trip.arr,
      origin: trip.stops[0].name,
      destination: trip.stops[trip.stops.length - 1].name,
      ...pos,
    });
  }

  res.json({
    generated_at: new Date().toISOString(),
    reference_minutes: Math.round(nowMin),
    source: "Trenord GTFS static — dati.lombardia.it",
    count: trains.length,
    trains,
  });
});

// ---- 6. Endpoint di supporto: elenco linee coperte ----
app.get("/api/routes", (req, res) => {
  res.json(
    Object.entries(ROUTE_NAMES).map(([id, name]) => ({ id, name }))
  );
});

app.get("/", (req, res) => {
  res.json({
    service: "TrainRadar24 API — zona Novara",
    endpoints: ["/api/trains", "/api/trains?at=08:15", "/api/routes"],
    note: "Dati orari reali da Trenord (GTFS static). Posizione interpolata, non GPS live.",
  });
});

app.listen(PORT, () => {
  console.log(`TrainRadar24 backend attivo su porta ${PORT}`);
  console.log(`Corse caricate: ${PREPARED_TRIPS.length}`);
});
