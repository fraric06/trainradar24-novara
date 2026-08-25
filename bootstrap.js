const fs=require('fs');
const path=require('path');
const { load, CACHE }=require('./regional-loader');
const localPath=path.join(__dirname,'data','trips.json');
const serverPath=path.join(__dirname,'server.js');
const appJsPath=path.join(__dirname,'public','app.js');
const indexPath=path.join(__dirname,'public','index.html');
function patchRuntimeConfig(){
  let source=fs.readFileSync(serverPath,'utf8');
  source=source.replace(/const DISPLAY_WINDOW=\d+,MAX_VISIBLE=500;/,'const DISPLAY_WINDOW=5,MAX_VISIBLE=500;');
  source=source.replace(/const STATION_IDS=\[[^\]]*\];/,"const STATION_IDS=['S00248','S00023','S00034','S01066','S01037','S00219','S01700'];");
  source=source.replace(/function category\(trip\)\{[\s\S]*?\}function scheduledTrainNumber/,"function category(trip){if(trip.region){const x=String(trip.category||'')+' '+String(trip.route_name||'')+' '+String(trip.route||'');const names=(trip.stops||[]).map(s=>String(s.name||'')).join(' ');if(x.toUpperCase().includes('REGIONALE VELOCE')||/\\bRV\\b/i.test(x)||((/TORINO/i.test(x)||/TORINO/i.test(names))&&(/MILANO/i.test(x)||/MILANO/i.test(names))))return'RV';return'REG'}const x=`${trip.category||''} ${trip.route_name||''} ${trip.route||''}`.toUpperCase();const names=(trip.stops||[]).map(s=>String(s.name||'').toUpperCase()).join(' ');if(x.includes('REGIONALE VELOCE')||/\\bRV\\b/.test(x)||((/TORINO/.test(x)||/TORINO/.test(names))&&(/MILANO/.test(x)||/MILANO/.test(names))))return'RV';if(x.includes('MALPENSA')||x.includes('MXP'))return'MXP';if(x.includes('SFM'))return'SFM';if(/^S\\d/.test(String(trip.route||''))||x.includes('SUBURB'))return'SUB';return'REG'}function scheduledTrainNumber");
  fs.writeFileSync(serverPath,source);
  let app=fs.readFileSync(appJsPath,'utf8');
  app=app.replace(/DISPLAY_WINDOW=\d+;/,'DISPLAY_WINDOW=5;');
  app=app.replace(/function category\(t\)\{[\s\S]*?\}function delayColor/,"function category(t){if(String(t.region||'').trim()){const x=String(t.category||'').toUpperCase()+' '+String(t.route_name||'').toUpperCase()+' '+String(t.route||'').toUpperCase(),names=(t.stops||[]).map(s=>String(s.name||'').toUpperCase()).join(' ');if(x.includes('REGIONALE VELOCE')||/\\bRV\\b/.test(x)||((/TORINO/.test(x)||/TORINO/.test(names))&&(/MILANO/.test(x)||/MILANO/.test(names))))return'RV';return'REG'}const x=String(t.category||'').toUpperCase()+' '+String(t.route_name||'').toUpperCase()+' '+String(t.route||'').toUpperCase();if(x.includes('REGIONALE VELOCE')||/\\bRV\\b/.test(x)||(/TORINO/.test(x)&&/MILANO/.test(x)))return'RV';if(x.includes('MALPENSA')||x.includes('MXP'))return'MXP';if(x.includes('SFM'))return'SFM';if(/^S\\d/.test(String(t.route||''))||x.includes('SUBURB'))return'SUB';return'REG'}function delayColor");
  fs.writeFileSync(appJsPath,app);
  let html=fs.readFileSync(indexPath,'utf8').replace(/20260825-regional\d+/g,'20260825-regional6');
  fs.writeFileSync(indexPath,html);
}
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
  try{patchRuntimeConfig();console.log('Config live: finestra 5 min + Torino Porta Nuova/Milano Centrale + regionali sempre REG/RV');}catch(e){console.error('Config live non applicata:',e.message)}
  require('./server');
})();
