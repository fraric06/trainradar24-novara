const fs=require('fs');
const path=require('path');
const {load:loadRegional,CACHE:REGIONAL_CACHE}=require('./regional-loader');
const localPath=path.join(__dirname,'data','trips.json');
function byRegion(trips){const m=new Map();for(const t of trips||[])if(t.region)m.set(t.region,(m.get(t.region)||[]).concat(t));return m}
(async()=>{
  const local=JSON.parse(fs.readFileSync(localPath,'utf8'));
  const regionalResult=await loadRegional().catch(e=>({trips:[],status:{error:e.message}}));
  const regionalCache=fs.existsSync(REGIONAL_CACHE)?JSON.parse(fs.readFileSync(REGIONAL_CACHE,'utf8')):{trips:[]};
  const fresh=regionalResult.trips||[];
  const cached=regionalCache.trips||[];
  const regional=fresh.length?fresh:(cached.length?cached:local.filter(t=>t&&t.region));
  const counts=byRegion(regional);
  console.log('=== TrainRadar24 · caricamento regionale italiano ===');
  for(const [code,trips] of counts)console.log(`GTFS ${code}: ${trips.length} corse`);
  const legacy=local.filter(t=>t&&!t.region);
  fs.writeFileSync(localPath,JSON.stringify([...legacy,...regional]));
  console.log(`TrainRadar24: ${legacy.length} legacy + ${regional.length} regionali da ${counts.size} regioni`);
  console.log(`Feed regionale: ${fresh.length?'FRESH':'CACHE/FALLBACK'}`);
  console.log('Finestra visualizzazione: ±5 minuti');
  require('./server-national-v5');
})();
