# TrainRadar24 — copertura ferroviaria italiana

## Architettura regionale
Il caricamento statico non è più limitato a Piemonte e Lombardia. `regional-loader.js` legge `data/regional_sources.json`, gestisce tutte le 20 regioni italiane e costruisce un unico dataset normalizzato.

### Regioni gestite
PIE, VDA, LOM, LIG, TAA, VEN, FVG, EMR, TOS, UMB, MAR, LAZ, ABR, MOL, CAM, PUG, BAS, CAL, SIC, SAR.

### Priorità delle fonti
1. GTFS regionale ufficiale quando esiste un endpoint stabile configurato.
2. Feed Trenitalia nazionale come fallback per le regioni senza endpoint regionale stabile.
3. Cache dell'ultimo dataset valido se una fonte temporaneamente non risponde.

Il fallback nazionale viene partizionato per regione tramite le coordinate delle fermate e le bounding box regionali. Questo non sostituisce nel lungo periodo i GTFS ufficiali degli operatori regionali: serve a evitare che la mappa resti vuota fuori da Piemonte/Lombardia mentre le fonti regionali vengono aggiunte.

## Modello dati
Ogni corsa normalizzata contiene regione, operatore, route, categoria, numero commerciale quando disponibile, origine, destinazione, fermate, orari e coordinate. Il numero commerciale non viene derivato dal `trip_id`.

## Realtime
Il realtime rimane separato dal GTFS statico. `national-loader-v4.js` interroga ViaggiaTreno e associa il realtime alle corse tramite numero treno e contesto della partenza. Il GTFS regionale serve per ricostruire la posizione quando il realtime diretto non è disponibile.

## Obiettivo operativo
La mappa deve mostrare treni su scala italiana, non soltanto il corridoio Novara–Milano. L'espansione regionale è incrementale: appena viene trovata una fonte ufficiale stabile per una regione, va inserita in `data/regional_sources.json` e prende automaticamente priorità sul fallback nazionale.
