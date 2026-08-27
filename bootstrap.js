const national=require('./national-loader-v9');
const {normalizePayload}=require('./train-normalizer');
const rawLoad=national.load.bind(national);
national.load=async()=>normalizePayload(await rawLoad());
national.realtime=national.load;
(async()=>{console.log('=== TrainRadar24 · Piemonte realtime verificato V11 ===');try{const x=await national.load();console.log(`Avvio realtime V11: stazioni=${x.status.stations} treni_verificati=${x.trips.length}`)}catch(e){console.error('Errore avvio realtime:',e.message)}require('./server-national-v9')})();
