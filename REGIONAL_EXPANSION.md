# TrainRadar24 — Piemonte + Lombardia

Roadmap tecnica per l'espansione regionale.

## Scope
- Piemonte: SFR, SFM e servizi regionali disponibili nei GTFS regionali.
- Lombardia: Trenord, Malpensa Express e servizi regionali presenti nel GTFS regionale.
- Regionali Veloci Torino–Milano: includere esplicitamente come categoria `RV/RE` quando presenti nelle fonti ufficiali, senza confonderli con gli AV.

## Fonti programmate
- Piemonte: GTFS ferroviario regionale della Regione Piemonte.
- Lombardia: GTFS ferroviario regionale pubblicato da Regione Lombardia/Trenord.

## Modello dati previsto
Ogni corsa regionale deve avere: regione, operatore, route_id, trip_id, numero commerciale, categoria servizio, origine, destinazione, fermate, stop_times, shape/polilinea quando disponibile, calendario.

## Realtime
Il realtime deve essere separato dal programmato e associato alla corsa tramite numero commerciale + contesto di corsa (stazione/timestamp), mantenendo l'ultimo dato valido per evitare sfarfallii. Per Trenord è disponibile un'API E015 GTFS Static e Real-time che espone ritardi effettivi, ritardi previsti e soppressioni.

## Visualizzazione
- rete ferroviaria reale;
- treni attivi solamente sulla rete ferroviaria;
- colori ritardo: verde 0–4 min, giallo 5–30 min, rosso >30 min;
- fallback neutro quando il realtime non è disponibile;
- filtri Regione, operatore, categoria e linea;
- ricerca per numero treno/stazione;
- geolocalizzazione utente.

## Nota RV Torino–Milano
I Regionali Veloci Torino–Milano sono inclusi nello scope. Il loro numero commerciale deve provenire dal dato ufficiale della corsa e non essere derivato da trip_id GTFS.
