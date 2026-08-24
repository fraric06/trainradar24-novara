const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const TRIPS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "trips.json"), "utf-8"));
const ROUTE_NAMES = { S6: "Novara–Milano Passante–Treviglio", R27: "Novara–Saronno–Milano", R25: "Novara–Mortara" };

function haversine(a,b,c,d){const R=6371,toRad=x=>x*Math.PI/180,dl=toRad(c-a),dn=toRad(d-b),x=Math.sin(dl/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function prepareTrip(t){let dist=0, cum=[0];for(let i=1;i<t.stops.length;i++){dist+=haversine(t.stops[i-1].lat,t.stops[i-1].lon,t.stops[i].lat,t.stops[i].lon);cum.push(dist)}return {...t,cumDist:cum,totalDist:dist}}
const PREPARED_TRIPS=TRIPS.map(prepareTrip);
function nowMinutes(override){if(override&&/^\d{1,2}:\d{2}$/.test(override)){const [h,m]=override.split(":").map(Number);return h*60+m}const d=new Date();return d.getHours()*60+d.getMinutes()+d.getSeconds()/60}
function estimatePosition(trip,nowMin,delay=0){const first=trip.stops[0],last=trip.stops.at(-1),dep=first.dep_min+delay,arr=last.arr_min+delay;if(nowMin<dep-5||nowMin>arr+5)return null;if(nowMin<=dep)return{status:"not_departed",lat:first.lat,lon:first.lon,nextStop:first.name,etaMin:Math.max(0,Math.round(dep-nowMin))};if(nowMin>=arr)return{status:"arrived",lat:last.lat,lon:last.lon,nextStop:null,etaMin:0};for(let i=0;i<trip.stops.length-1;i++){const a=trip.stops[i],b=trip.stops[i+1],ad=a.dep_min+delay,ba=b.arr_min+delay;if(nowMin>=ad&&nowMin<=ba){const t=(nowMin-ad)/(ba-ad||1);return{status:"running",lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t,fromStop:a.name,nextStop:b.name,etaMin:Math.max(0,Math.round(ba-nowMin)),progress:Math.round(t*100)}}}return null}

// Realtime is deliberately optional: if the external service changes, the map keeps working on GTFS.
const LIVE_URLS=[
  "https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/S00248/",
  "https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/arrivi/S00248/"
];
let realtime={available:false,updatedAt:null,trains:[],error:null};

function parseDelay(v){if(typeof v==='number'&&Number.isFinite(v))return Math.max(0,Math.round(v));if(typeof v==='string'&&v.trim()&&Number.isFinite(Number(v)))return Math.max(0,Math.round(Number(v)));return null}
function extract(item){const n=String(item?.numeroTreno??item?.numero??"").trim();const delay=parseDelay(item?.ritardo??item?.delay??item?.ritardoArrivo??item?.ritardoPartenza);if(!n)return null;return{number:n,delayMin:delay??0,destination:item?.destinazione??null,origin:item?.origine??null,cancelled:Boolean(item?.soppresso||item?.soppressione)}}
async function refreshRealtime(){
  const rows=[];let lastError=null;
  for(const base of LIVE_URLS){try{const url=base+encodeURIComponent(new Date().toString());const r=await fetch(url,{signal:AbortSignal.timeout(6000),headers:{Accept:"application/json"}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const data=await r.json();if(Array.isArray(data))for(const item of data){const x=extract(item);if(x)rows.push(x)}}catch(e){lastError=e.message}}
  if(rows.length){realtime={available:true,updatedAt:new Date().toISOString(),trains:rows,error:null};console.log(`Realtime disponibile: ${rows.length} record`)}else{realtime={...realtime,available:false,error:lastError||"Nessun record realtime"};console.log(`Realtime non disponibile: ${realtime.error}`)}
}

function realtimeDelayForTrip(trip){if(!realtime.available||!realtime.trains.length)return null;const scheduled=trip.stops[0].dep_min;const hh=Math.floor(scheduled/60)%24,mm=Math.floor(scheduled%60);const target=hh*60+mm;let best=null;for(const x of realtime.trains){const n=Number(x.number);if(!Number.isFinite(n))continue;const diff=Math.abs((n%10000)-target);if(best===null||diff<best.diff)best={...x,diff}}return best&&best.diff<20?best:null}

app.get("/api/trains",(req,res)=>{const now=nowMinutes(req.query.at),trains=[];for(const trip of PREPARED_TRIPS){const live=req.query.at?null:realtimeDelayForTrip(trip);const delay=live?.delayMin??0;const pos=estimatePosition(trip,now,delay);if(!pos)continue;trains.push({trip_id:trip.trip_id,route:trip.route,route_name:ROUTE_NAMES[trip.route]||trip.route,dep:trip.dep,arr:trip.arr,origin:trip.stops[0].name,destination:trip.stops.at(-1).name,delay_min:delay,delay_status:delay<5?"on_time":delay<=30?"delayed":"severe_delay",realtime:Boolean(live),realtime_train_number:live?.number??null,realtime_updated_at:realtime.updatedAt,cancelled:live?.cancelled??false,...pos})}res.json({generated_at:new Date().toISOString(),reference_minutes:Math.round(now),source:realtime.available?"GTFS + ViaggiaTreno/RFI realtime":"GTFS static — realtime non disponibile",realtime_available:realtime.available,realtime_updated_at:realtime.updatedAt,count:trains.length,trains})});
app.get("/api/realtime-status",(req,res)=>res.json({available:realtime.available,updated_at:realtime.updatedAt,record_count:realtime.trains.length,error:realtime.error}));
app.get("/api/routes",(req,res)=>res.json(Object.entries(ROUTE_NAMES).map(([id,name])=>({id,name}))));
app.get("/",(req,res)=>res.json({service:"TrainRadar24 API — zona Novara",endpoints:["/api/trains","/api/realtime-status","/api/routes"],status:realtime.available?"realtime":"fallback GTFS"}));
app.listen(PORT,()=>{console.log(`TrainRadar24 backend attivo su porta ${PORT}`);console.log(`Corse caricate: ${PREPARED_TRIPS.length}`);refreshRealtime();setInterval(refreshRealtime,30000)});
