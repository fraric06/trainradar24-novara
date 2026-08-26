process.env.TZ='Europe/Rome';
const fs=require('fs'),path=require('path'),https=require('https'),http=require('http');

const ROOT=__dirname;
const DATA_DIR=path.join(ROOT,'data');
const STATIONS_CACHE=path.join(DATA_DIR,'national-stations.json');
const LIVE_CACHE=path.join(DATA_DIR,'national-live.json');
const VT_BASE='https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const CACHE_TTL_MS=24*60*60*1000;
const BOARD_SCAN_MS=5*60*1000;
const DISPLAY_WINDOW=5;
const CONCURRENCY=12;
const TRAIN_CONCURRENCY=18;

let stations=[];
let stationMap=new Map();
let live=new Map();
let lastScan=0;
let scanPromise=null;
let lastError=null;
let lastUpdated=null;

function request(url,timeout=12000,redirects=0){
  return new Promise((resolve,reject)=>{
    if(redirects>5)return reject(new Error('troppi redirect'));
    const u=new URL(url),client=u.protocol==='http:'?http:https;
    const req=client.get(u,{headers:{'User-Agent':'TrainRadar24-Nazionale/10.0','Accept':'application/json,text/plain,*/*','Connection':'close'}},res=>{
      if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();return resolve(request(new URL(res.headers.location,u).toString(),timeout,redirects+1));}
      let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);res.on('end',()=>{
        if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(body);
      });
    });
    req.setTimeout(timeout,()=>req.destroy(new Error(`timeout ${timeout}ms`)));
    req.on('error',reject);
  });
}
async function json(url){const body=await request(url);return JSON.parse(body);}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(e){out[i]={error:e.message};}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}
function save(file,data){try{fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(file,JSON.stringify(data));}catch(e){console.error('cache write:',e.message)}}
function loadFile(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null}}
function now(){return Date.now();}
function midnightMs(){const d=new Date();d.setHours(0,0,0,0);return d.getTime();}
function boardDate(){return new Date().toString().replace(/ \([^)]*\)$/,'');}
function stationName(s){return s?.localita?.nomeLungo||s?.localita?.nomeBreve||s?.nomeCitta||s?.codiceStazione||s?.codStazione||'';}
function category(raw){
  const s=String(raw?.categoria||raw?.categoriaDescrizione||raw?.compNumeroTreno||'').toUpperCase();
  if(/FR|FA|FB|FRECCIA|AV/.test(s))return'AV';
  if(/ICN|INTERCITY/.test(s)||/^IC\b/.test(s))return'IC';
  if(/RV|REGIONALE VELOCE/.test(s))return'RV';
  return'REG';
}
function numberOf(raw){return String(raw?.numeroTreno??raw?.train_number??'').trim();}
function ts(v){const n=Number(v);return Number.isFinite(n)&&n>100000000000?n:null;}
function stopTime(s){return ts(s?.programmata)||ts(s?.partenza_teorica)||ts(s?.arrivo_teorico)||null;}
function delayOf(s){const n=Number(s);return Number.isFinite(n)?Math.round(n):0;}
function normStops(stops){
  return (Array.isArray(stops)?stops:[]).map((s,i)=>{
    const code=s?.id||s?.codiceStazione||'';
    const meta=stationMap.get(code)||{};
    const scheduled=stopTime(s);
    const lat=Number(meta.lat),lon=Number(meta.lon);
    return {id:code,name:s?.stazione||meta.name||code,lat,lon,scheduled,arr:ts(s?.arrivo_teorico),dep:ts(s?.partenza_teorica),arrReal:ts(s?.arrivoReale),depReal:ts(s?.partenzaReale),delay:delayOf(s?.ritardo),delayArr:delayOf(s?.ritardoArrivo),delayDep:delayOf(s?.ritardoPartenza),type:s?.tipoFermata||'F',actualType:Number(s?.actualFermataType??1),seq:i};
  }).filter(s=>s.id&&Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&s.scheduled);
}
function effectiveSchedule(stops,globalDelay){
  return stops.map(s=>({...s,effective:s.scheduled+Math.max(0,(s.delay||0))*60000}));
}
function interpolate(stops,globalDelay,nowMs){
  if(stops.length<2)return null;
  const ss=effectiveSchedule(stops,globalDelay);
  const first=ss[0],last=ss[ss.length-1];
  if(nowMs<first.effective-DISPLAY_WINDOW*60000)return{status:'not_departed',lat:first.lat,lon:first.lon,nextStop:first.name,progress:0};
  if(nowMs>last.effective+DISPLAY_WINDOW*60000)return null;
  if(nowMs>=last.effective)return{status:'arrived',lat:last.lat,lon:last.lon,nextStop:'—',progress:100};
  for(let i=0;i<ss.length-1;i++){
    const a=ss[i],b=ss[i+1],ta=a.effective,tb=b.effective;
    if(nowMs>=ta&&nowMs<=tb){
      const q=Math.max(0,Math.min(1,(nowMs-ta)/Math.max(1,tb-ta)));
      return{status:'running',lat:a.lat+(b.lat-a.lat)*q,lon:a.lon+(b.lon-a.lon)*q,nextStop:b.name,progress:Math.round(q*100)};
    }
  }
  return null;
}
function keepWindow(trip,nowMs){
  const dep=trip.stops?.[0]?.scheduled,arr=trip.stops?.at(-1)?.scheduled;
  if(!dep||!arr)return false;
  const d=dep+Math.max(0,trip.delay_min||0)*60000,a=arr+Math.max(0,trip.delay_min||0)*60000;
  return nowMs>=d-DISPLAY_WINDOW*60000&&nowMs<=a+DISPLAY_WINDOW*60000;
}
async function loadStations(){
  const cached=loadFile(STATIONS_CACHE);
  if(cached?.saved&&Array.isArray(cached.stations)&&now()-cached.saved<CACHE_TTL_MS){stations=cached.stations;stationMap=new Map(cached.coords||[]);return;}
  let main=[];
  try{main=await json(`${VT_BASE}/elencoStazioni/0`);}catch(e){if(cached?.stations){stations=cached.stations;stationMap=new Map(cached.coords||[]);return;}throw e;}
  const by=new Map();
  for(const s of Array.isArray(main)?main:[]){const code=s?.codiceStazione||s?.codStazione||s?.localita?.id;if(code)by.set(code,{code,name:stationName(s),lat:Number(s.lat),lon:Number(s.lon),type:Number(s.tipoStazione||0)});}
  const regions=Array.from({length:20},(_,i)=>i+1);
  const regional=await mapLimit(regions,5,async r=>{try{return await json(`${VT_BASE}/elencoStazioni/${r}`);}catch{return[];}});
  for(const arr of regional){for(const s of Array.isArray(arr)?arr:[]){const code=s?.codiceStazione||s?.codStazione||s?.localita?.id;if(!code)continue;by.set(code,{code,name:stationName(s),lat:Number(s.lat),lon:Number(s.lon),type:Number(s.tipoStazione||0)});}}
  stationMap=new Map();for(const [code,s] of by){if(Number.isFinite(s.lat)&&Number.isFinite(s.lon))stationMap.set(code,s);}
  stations=[...new Map((Array.isArray(main)?main:[]).map(s=>{const code=s?.codiceStazione||s?.codStazione||s?.localita?.id;return [code,{code,name:stationName(s),lat:Number(s.lat),lon:Number(s.lon),type:Number(s.tipoStazione||0)}];}).filter(([k])=>k)).values()];
  if(stations.length<80)stations=[...stationMap.values()].filter(s=>s.type!==4).slice(0,260);
  save(STATIONS_CACHE,{saved:now(),stations,coords:[...stationMap.entries()]});
}
async function board(code,kind){
  const endpoint=kind==='dep'?'partenze':'arrivi';
  const url=`${VT_BASE}/${endpoint}/${encodeURIComponent(code)}/${encodeURIComponent(boardDate())}`;
  try{return await json(url);}catch(e){return[];}
}
async function discover(){
  const seen=new Map();
  const results=await mapLimit(stations,CONCURRENCY,async s=>{
    const arr=await Promise.all([board(s.code,'dep'),board(s.code,'arr')]);
    return arr.flat().map(x=>({...x,_boardStation:s.code,_boardName:s.name}));
  });
  for(const batch of results){for(const raw of Array.isArray(batch)?batch:[]){
    const n=numberOf(raw),origin=raw?.codOrigine||raw?.codLocOrig||'';
    const day=String(raw?.dataPartenzaTreno||raw?.millisDataPartenza||midnightMs());
    if(!n||!origin)continue;
    const key=`${n}|${origin}|${day}`;
    const old=seen.get(key);if(!old||Number(raw.ritardo||0)>Number(old.ritardo||0)||raw.circolante&&!old.circolante)seen.set(key,raw);
  }}
  return [...seen.values()];
}
async function detail(raw){
  const n=numberOf(raw),origin=raw?.codOrigine||raw?.codLocOrig||'',day=Number(raw?.dataPartenzaTreno||raw?.millisDataPartenza||midnightMs());
  if(!n||!origin||!Number.isFinite(day))return null;
  try{
    const d=await json(`${VT_BASE}/andamentoTreno/${encodeURIComponent(origin)}/${encodeURIComponent(n)}/${day}`);
    const rawStops=Array.isArray(d?.fermate)?d.fermate:[];
    const stops=normStops(rawStops);
    if(stops.length<2)return null;
    const delay=Math.max(0,delayOf(d?.ritardo));
    const p=interpolate(stops,delay,now());
    if(!p)return null;
    const cancelled=String(d?.tipoTreno||'').toUpperCase()==='ST'||Number(d?.provvedimento)===1;
    const key=`national-${n}-${origin}-${day}`;
    return {trip_id:key,source_trip_id:`${n}-${origin}-${day}`,route:category(raw),route_name:`${d?.origine||stops[0].name} → ${d?.destinazione||stops.at(-1).name}`,category:category(d),region:'nazionale',operator:'Trenitalia/ViaggiaTreno',dep:new Date(stops[0].scheduled).toISOString(),arr:new Date(stops.at(-1).scheduled).toISOString(),origin:d?.origine||stops[0].name,destination:d?.destinazione||stops.at(-1).name,train_number:n,delay_min:delay,delay_known:true,delay_status:delay<5?'on_time':delay<=30?'delayed':'severe_delay',realtime:true,realtime_source:'ViaggiaTreno',realtime_updated_at:new Date().toISOString(),cancelled,stops,lat:p.lat,lon:p.lon,status:p.status,nextStop:p.nextStop,progress:p.progress,etaMin:Math.max(0,Math.round((stops.at(-1).scheduled-now())/60000))};
  }catch{return null;}
}
async function scan(){
  try{
    await loadStations();
    const discovered=await discover();
    const details=await mapLimit(discovered,TRAIN_CONCURRENCY,detail);
    const next=new Map();
    for(const t of details)if(t)next.set(t.trip_id,t);
    for(const [id,t] of live){if(now()-Date.parse(t.realtime_updated_at||0)<7*60*1000&&keepWindow(t,now()))next.set(id,t);}
    live=next;lastScan=now();lastUpdated=new Date().toISOString();lastError=null;
    save(LIVE_CACHE,{saved:lastScan,trips:[...live.values()]});
    console.log(`ViaggiaTreno nazionale: ${discovered.length} corse scoperte, ${live.size} treni visibili`);
    return [...live.values()];
  }catch(e){lastError=e.message;console.error('ViaggiaTreno nazionale:',e.message);const cached=loadFile(LIVE_CACHE);if(cached?.trips)live=new Map(cached.trips.map(t=>[t.trip_id,t]));return [...live.values()];}
}
async function load(){
  if(!scanPromise&&(now()-lastScan>=BOARD_SCAN_MS||!live.size))scanPromise=scan().finally(()=>{scanPromise=null;});
  if(scanPromise&&(!live.size||now()-lastScan>=BOARD_SCAN_MS))await scanPromise;
  const current=[...live.values()].filter(t=>keepWindow(t,now()));
  return {generatedAt:new Date().toISOString(),source:'ViaggiaTreno realtime nazionale',trips:current,status:{stations:stations.length,liveTrains:current.length,lastScan:lastUpdated,error:lastError,displayWindowMinutes:DISPLAY_WINDOW}};
}
async function realtime(){return {available:true,source:'ViaggiaTreno realtime nazionale'};}
module.exports={load,realtime,CACHE:LIVE_CACHE,RT_URL:VT_BASE,DISPLAY_WINDOW};
