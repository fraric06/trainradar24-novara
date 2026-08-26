const national=require('./national-loader-v7');
(async()=>{
  console.log('=== TrainRadar24 · Piemonte realtime · dati verificati ViaggiaTreno ===');
  try{const x=await national.load();console.log(`Avvio realtime V7: stazioni=${x.status.stations} treni_verificati=${x.trips.length}`)}catch(e){console.error('Errore avvio realtime:',e.message)}
  require('./server-national-v7');
})();
