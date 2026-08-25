const fs=require('fs');
const path=require('path');
const { load, CACHE }=require('./regional-loader');
const localPath=path.join(__dirname,'data','trips.json');
(async()=>{
  try{
    const result=await load();
    const local=JSON.parse(fs.readFileSync(localPath,'utf8'));
    let cached=[];
    if(fs.existsSync(CACHE)){
      try{cached=JSON.parse(fs.readFileSync(CACHE,'utf8')).trips||[]}catch{}
    }
    const freshByRegion=new Map();
    for(const t of result.trips||[])if(t.region)freshByRegion.set(t.region,(freshByRegion.get(t.region)||[]).concat(t));
    const cachedByRegion=new Map();
    for(const t of cached)if(t.region)cachedByRegion.set(t.region,(cachedByRegion.get(t.region)||[]).concat(t));
    const regional=[];
    for(const region of ['piemonte','lombardia']){
      const chosen=freshByRegion.get(region)?.length?freshByRegion.get(region):cachedByRegion.get(region)||[];
      regional.push(...chosen);
      console.log(`GTFS ${region}: ${chosen.length} corse (${freshByRegion.get(region)?.length?'fresh':'cache'})`);
    }
    const keep=local.filter(t=>!t.region);
    fs.writeFileSync(localPath,JSON.stringify([...keep,...regional]));
    console.log(`GTFS regionale totale: ${regional.length} corse`);
    console.log(JSON.stringify(result.status));
  }catch(e){console.error('GTFS regionale non disponibile:',e.message)}
  require('./server');
})();
