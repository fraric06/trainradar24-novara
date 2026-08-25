const fs=require('fs');
const path=require('path');
const { load }=require('./regional-loader');
const localPath=path.join(__dirname,'data','trips.json');
(async()=>{
  try{
    const result=await load();
    const local=JSON.parse(fs.readFileSync(localPath,'utf8'));
    const regional=(result.trips||[]).filter(t=>t.region==='piemonte'||t.region==='lombardia');
    const keep=local.filter(t=>!t.region);
    fs.writeFileSync(localPath,JSON.stringify([...keep,...regional]));
    console.log(`GTFS regionale: ${regional.length} corse aggiunte`);
    console.log(JSON.stringify(result.status));
  }catch(e){console.error('GTFS regionale non disponibile:',e.message)}
  require('./server');
})();
