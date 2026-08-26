const fs=require('fs');
const path=require('path');
const {load:loadRegional,CACHE:REGIONAL_CACHE}=require('./regional-loader');
const {load:loadNational}=require('./national-loader');
const localPath=path.join(__dirname,'data','trips.json');
function byRegion(trips){const m=new Map();for(const t of trips||[])if(t.region)m.set(t.region,(m.get(t.region)||[]).concat(t));return m}
(async()=>{
  const local=JSON.parse(fs.readFileSync(localPath,'utf8'));
  const regionalResult=await loadRegional().catch(e=>({trips:[],status:{error:e.message}}));
  const nationalResult=await loadNational().catch(e=>({trips:[],status:{error:e.message}}));
  const regionalCache=fs.existsSync(REGIONAL_CACHE)?JSON.parse(fs.readFileSync(REGIONAL_CACHE,'utf8')):{trips:[]};
  const fresh=byRegion(regionalResult.trips),cached=byRegion(regionalCache.trips);
  const regional=[];
  for(const region of ['piemonte','lombardia']){
    const chosen=fresh.get(region)?.length?fresh.get(region):cached.get(region)||[];
    regional.push(...chosen);
    console.log(`GTFS ${region}: ${chosen.length} corse`);
  }
  const national=Array.isArray(nationalResult.trips)?nationalResult.trips:[];
  const keep=local.filter(t=>!t.region||t.region==='piemonte'||t.region==='lombardia');
  fs.writeFileSync(localPath,JSON.stringify([...keep,...regional,...national]));
  console.log(`TrainRadar24: ${keep.length} locali + ${regional.length} regionali + ${national.length} nazionali statiche`);
  console.log('Finestra visualizzazione realtime: ±5 minuti');
  require('./server-national-v2');
})();
