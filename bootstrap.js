const national=require('./national-loader-v6');
(async()=>{
  console.log('=== TrainRadar24 · Piemonte realtime verificato ===');
  try{const x=await national.load();console.log(`Avvio realtime: stazioni=${x.status.stations} treni_verificati=${x.trips.length}`)}catch(e){console.error('Errore avvio realtime:',e.message)}
  require('./server-national-v6');
})();
