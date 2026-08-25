const { load, CACHE } = require('./regional-loader');
(async()=>{
  try {
    const result=await load();
    const total=result.trips?.length||0;
    console.log(`GTFS regionale: ${total} corse caricate`);
    console.log(JSON.stringify(result.status));
  } catch(e) {
    console.error('GTFS regionale non disponibile:',e.message);
  }
  require('./server');
})();
