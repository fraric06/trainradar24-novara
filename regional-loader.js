const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const https = require('https');

const ROOT = __dirname;
const CACHE = path.join(ROOT, 'data', 'regional-trips.json');
const SOURCES = {
  lombardia: 'https://www.dati.lombardia.it/download/3z4k-mxz9/application/zip',
  piemonte: 'https://api.smartdatanet.it/api/ServizioProgrammatoDelTrasportoPubblicoRegionePiemonteTreniRegionali_5188/attachment/5187/1/GTFS_RAIL_IT_PIE.zip'
};

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('troppi redirect'));
    https.get(url, { headers: { 'User-Agent': 'TrainRadar24/1.0' } }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function csv(text) {
  const rows=[]; let row=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(quoted){ if(c==='"' && n==='"'){cell+='"';i++;} else if(c==='"') quoted=false; else cell+=c; }
    else if(c==='"') quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  if(!rows.length)return [];
  const head=rows[0].map(x=>x.trim());
  return rows.slice(1).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]??''])));
}

function file(zip, name){ try { const e=zip.getEntry(name); return e ? e.getData().toString('utf8') : ''; } catch { return ''; } }
function minTime(v){ const m=String(v||'').match(/^(\d+):(\d{2})/); return m ? Number(m[1])*60+Number(m[2]) : null; }
function today(){ const d=new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; }
function activeServices(calendar, dates){
  const day=new Date().getDay(); const key=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][day];
  const out=new Set();
  for(const r of calendar){ if(r.start_date<=today()&&r.end_date>=today()&&r[key]==='1') out.add(r.service_id); }
  for(const r of dates){ if(r.date===today()){ if(r.exception_type==='1') out.add(r.service_id); if(r.exception_type==='2') out.delete(r.service_id); } }
  return out;
}
function normalize(zipBuffer, region){
  const z=new AdmZip(zipBuffer);
  const routes=csv(file(z,'routes.txt')); const stops=csv(file(z,'stops.txt')); const trips=csv(file(z,'trips.txt'));
  const stopTimes=csv(file(z,'stop_times.txt')); const calendar=csv(file(z,'calendar.txt')); const dates=csv(file(z,'calendar_dates.txt'));
  const active=activeServices(calendar,dates); const stopMap=new Map(stops.map(s=>[s.stop_id,s]));
  const routeMap=new Map(routes.map(r=>[r.route_id,r]));
  const byTrip=new Map();
  for(const s of stopTimes){ if(!byTrip.has(s.trip_id)) byTrip.set(s.trip_id,[]); byTrip.get(s.trip_id).push(s); }
  const out=[];
  for(const t of trips){
    if(t.service_id && active.size && !active.has(t.service_id)) continue;
    const rt=routeMap.get(t.route_id)||{}; const ss=(byTrip.get(t.trip_id)||[]).sort((a,b)=>Number(a.stop_sequence)-Number(b.stop_sequence));
    if(ss.length<2) continue;
    const stopsOut=ss.map(s=>{const p=stopMap.get(s.stop_id)||{}; const arr=minTime(s.arrival_time), dep=minTime(s.departure_time); return {id:s.stop_id,name:p.stop_name||s.stop_id,lat:Number(p.stop_lat),lon:Number(p.stop_lon),arr:s.arrival_time,dep:s.departure_time,arr_min:arr,dep_min:dep};}).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&s.arr_min!==null&&s.dep_min!==null);
    if(stopsOut.length<2) continue;
    const category=String(t.train_category||rt.route_type||'REG').toUpperCase();
    const short=String(t.trip_short_name||'').trim();
    out.push({trip_id:`${region}-${t.trip_id}`,route:rt.route_short_name||t.route_id,route_name:rt.route_long_name||rt.route_short_name||t.route_id,category,train_number:short||null,region,dep:stopsOut[0].dep,arr:stopsOut.at(-1).arr,dep_min:stopsOut[0].dep_min,stops:stopsOut});
  }
  return out;
}

async function load(){
  const all=[]; const status={};
  for(const [region,url] of Object.entries(SOURCES)){
    try { const buf=await download(url); const trips=normalize(buf,region); all.push(...trips); status[region]={ok:true,trips:trips.length,updatedAt:new Date().toISOString()}; }
    catch(e){ status[region]={ok:false,error:e.message}; }
  }
  if(all.length){ fs.writeFileSync(CACHE,JSON.stringify({generatedAt:new Date().toISOString(),status,trips:all})); }
  else if(fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE,'utf8'));
  return {generatedAt:new Date().toISOString(),status,trips:all};
}
module.exports={load,CACHE};
