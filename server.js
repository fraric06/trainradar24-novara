process.env.TZ = "Europe/Rome";
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
const PORT = process.env.PORT || 3000;
const TRIPS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "trips.json"), "utf8"));
const ROUTE_NAMES = {S6:"Novara – Milano Passante – Treviglio",R27:"Novara Nord – Saronno – Milano Cadorna",R25:"Mortara – Novara"};
const STATION_IDS=["S00248","S00023","S00034"];
function haversine(a,b,c,d){const R=6371,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b);const x=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function prepareTrip(t){let dist=0,cum=[0];for(let i=1;i<t.stops.length;i++){dist+=haversine(t.stops[i-1].lat,t.stops[i-1].lon,t.stops[i].lat,t.stops[i].lon);cum.push(dist)}return {...t,cumDist:cum,totalDist:dist};}
const PREPARED_TRIPS=TRIPS.map(prepareTrip);
function romeNow(){const d=new Date();return d.getHours()*60+d.getMinutes()+d.getSeconds()/60;}
function romeDate(){const d=new Date();const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`;}
function tripValidToday(t){const m=t.trip_id?.match(/-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})$/);if(!m)return true;const d=romeDate();return d>=m[1]&&d<=m[2];}
function estimatePosition(trip,nowMin,delay=0){const first=trip.stops[0],last=trip.stops.at(-1),dep=first.dep_min+delay,arr=last.arr_min+delay;if(nowMin<dep-5||nowMin>arr+5)return null;if(nowMin<=dep)return{status:"not_departed",lat:first.lat,lon:first.lon,nextStop:first.name,etaMin:Math.max(0,Math.round(dep-nowMin))};if(nowMin>=arr)return{status:"arrived",lat:last.lat,lon:last.lon,nextStop:null,etaMin:0};for(let i=0;i<trip.stops.length-1;i++){const a=trip.stops[i],b=trip.stops[i+1],ad=a.dep_min+delay,ba=b.arr_min+delay;if(nowMin>=ad&&nowMin<=ba){const q=(nowMin-ad)/(ba-ad||1);return{status:"running",lat:a.lat+(b.lat-a.lat)*q,lon:a.lon+(b.lon-a.lon)*q,fromStop:a.name,nextStop:b.name,etaMin:Math.max(0,Math.round(ba-nowMin)),progress:Math.round(q*100)}}}return null;}

function scheduledTrainNumber(trip){
  const raw=String(trip.trip_id||"").split("-")[0];
  if(trip.route==="S6"&&/^124\d+$/.test(raw))return raw.slice(1);
  if(trip.route==="R25"&&/^111\d+$/.test(raw))return raw.slice(1);
  if(trip.route!=="R27")return null;
  const dep=trip.stops[0]?.dep_min;
  const r27={371:"4214",431:"4222",491:"4226",551:"4232",611:"4236",671:"4240",731:"4244",791:"4246",851:"4250",911:"4254",971:"4260",1031:"4266",1091:"4270",1151:"4276",1211:"4280"};
  return r27[dep]||null;
}

let realtime={available:false,updatedAt:null,records:[],error:null};
function fetchJson(url){return new Promise((resolve,reject)=>{const req=https.get(url,{headers:{"User-Agent":"TrainRadar24-Novara/1.0","Accept":"application/json"}},res=>{let body="";res.setEncoding("utf8");res.on("data",c=>body+=c);res.on("end",()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP ${res.statusCode}`));try{resolve(JSON.parse(body))}catch(e){reject(new Error("JSON non valido"))}})});req.setTimeout(7000,()=>req.destroy(new Error("timeout")));req.on("error",reject);});}

// ViaggiaTreno is sensitive to the exact current local date/time format.
// Render runs in UTC by default, so TZ is forced to Europe/Rome above.
function vtDate(){ return new Date().toString(); }
function minuteFromDate(v){if(v===null||v===undefined)return null;const n=Number(v);if(Number.isFinite(n)){const d=new Date(n);return d.getHours()*60+d.getMinutes()}const s=String(v);const m=s.match(/(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null;}
function parseVT(item,stationId){const min=minuteFromDate(item?.orarioPartenza);if(min===null)return null;const rawDelay=Number(item?.ritardo);const delay=Number.isFinite(rawDelay)?Math.max(0,Math.round(rawDelay)):0;const number=String(item?.numeroTreno??"").trim();if(!number)return null;return{stationId,number,scheduledMin:min,delayMin:delay,destination:item?.destinazione||null,cancelled:Number(item?.provvedimento)===1,updatedAt:new Date().toISOString()};}
async function refreshRealtime(){
  const records=[];let errors=[];const date=encodeURIComponent(vtDate());
  for(const stationId of STATION_IDS){
    try{
      const data=await fetchJson(`https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/${stationId}/${date}`);
      if(Array.isArray(data))for(const item of data){const x=parseVT(item,stationId);if(x)records.push(x)}
    }catch(e){errors.push(`${stationId}: ${e.message}`)}
  }
  if(records.length){realtime={available:true,updatedAt:new Date().toISOString(),records,error:errors.length?errors.join(" | "):null};console.log(`ViaggiaTreno OK: ${records.length} partenze realtime`)}
  else{realtime={...realtime,available:false,error:errors.join(" | ")||"Nessun dato realtime"};console.log(`ViaggiaTreno NON DISPONIBILE: ${realtime.error}`)}
}
function findRealtime(trip,scheduledNumber){
  const candidates=realtime.records;
  if(scheduledNumber){const exact=candidates.find(r=>r.number===scheduledNumber&&r.stationId===trip.stops[0]?.id);if(exact)return exact;const anywhere=candidates.find(r=>r.number===scheduledNumber);if(anywhere)return anywhere;}
  let best=null;for(const r of candidates){if(r.stationId!==trip.stops[0]?.id)continue;const diff=Math.abs(r.scheduledMin-trip.stops[0].dep_min);if(diff<=3&&(!best||diff<best.diff))best={...r,diff};}return best;
}

app.get("/api/trains",(req,res)=>{try{const now=romeNow(),trains=[];for(const trip of PREPARED_TRIPS){if(!tripValidToday(trip))continue;const scheduledNumber=scheduledTrainNumber(trip),live=findRealtime(trip,scheduledNumber),delay=live?live.delayMin:0,pos=estimatePosition(trip,now,delay);if(!pos)continue;const displayNumber=scheduledNumber||live?.number||"";trains.push({trip_id:trip.trip_id,route:trip.route,route_name:ROUTE_NAMES[trip.route]||trip.route,dep:trip.dep,arr:trip.arr,origin:trip.stops[0].name,destination:trip.stops.at(-1).name,train_number:displayNumber,delay_min:delay,delay_known:Boolean(live),delay_status:!live?"unknown":delay<5?"on_time":delay<=30?"delayed":"severe_delay",realtime:Boolean(live),realtime_train_number:displayNumber,realtime_source_number:live?.number||null,realtime_updated_at:realtime.updatedAt,cancelled:live?.cancelled||false,...pos});}res.json({generated_at:new Date().toISOString(),reference_minutes:Math.round(now),source:realtime.available?"GTFS + ViaggiaTreno realtime":"GTFS static",realtime_available:realtime.available,realtime_updated_at:realtime.updatedAt,count:trains.length,trains});}catch(e){console.error("/api/trains",e);res.status(500).json({error:e.message,trains:[]})}});
app.get("/api/realtime-status",(req,res)=>res.json({available:realtime.available,updated_at:realtime.updatedAt,record_count:realtime.records.length,error:realtime.error}));
app.get("/api/health",(req,res)=>res.json({ok:true,trips:PREPARED_TRIPS.length,date:romeDate(),time:romeNow(),realtime:realtime.available}));
app.get("/api/routes",(req,res)=>res.json(Object.entries(ROUTE_NAMES).map(([id,name])=>({id,name}))));
app.listen(PORT,()=>{console.log(`TrainRadar24 backend attivo su porta ${PORT}`);console.log(`Corse caricate: ${PREPARED_TRIPS.length}`);refreshRealtime().catch(e=>console.error(e));setInterval(()=>refreshRealtime().catch(e=>console.error(e)),30000);});
