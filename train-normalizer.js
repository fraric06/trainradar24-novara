function clean(v){return String(v??'').trim().replace(/\s+/g,' ')}
function key(v){return clean(v).toUpperCase().replace(/&NBSP;/g,' ')}
function millis(v){const n=Number(v);return Number.isFinite(n)&&n>100000000000?n:null}
function fmt(ts){const n=millis(ts);return n?new Date(n).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Europe/Rome'}):null}
function normalizeTrain(t){
  if(!t||typeof t!=='object')return t;
  const stops=Array.isArray(t.stops)?[...t.stops].filter(s=>s&&clean(s.name)).sort((a,b)=>(Number(a.seq)||0)-(Number(b.seq)||0)):[];
  const names=new Set(stops.map(s=>key(s.name)));
  const first=stops[0],last=stops.at(-1);
  let origin=clean(t.origin),destination=clean(t.destination);
  const foreignOrigin=clean(t.origin_foreign),foreignDestination=clean(t.destination_foreign);
  const sameApiEndpoints=Boolean(first&&last&&key(first.name)!==key(last.name)&&origin&&destination&&key(origin)===key(destination));

  // The first/last verified ViaggiaTreno stops win over a broken or partial
  // summary pair. This specifically prevents impossible A -> A routes.
  if(sameApiEndpoints){origin=clean(first.name);destination=clean(last.name);}
  if(foreignOrigin&&!names.has(key(foreignOrigin)))origin=foreignOrigin;
  if(!origin&&first)origin=clean(first.name);

  // ViaggiaTreno's foreign fields are supplemental. Use a foreign destination
  // only when it is genuinely outside the Italian stop sequence; this avoids the
  // known Ventimiglia/Cuneo case where destinazioneEstera can be a border station.
  if(foreignDestination&&!names.has(key(foreignDestination))&&last&&key(destination)===key(last.name))destination=foreignDestination;
  if(!destination&&last)destination=clean(last.name);

  if(first&&last&&key(first.name)!==key(last.name)&&key(origin)===key(destination)){
    origin=clean(first.name);destination=clean(last.name);
    if(foreignOrigin&&!names.has(key(foreignOrigin)))origin=foreignOrigin;
    if(foreignDestination&&!names.has(key(foreignDestination))&&key(destination)===key(last.name))destination=foreignDestination;
  }

  let delay=Number.isFinite(Number(t.delay_min))?Math.round(Number(t.delay_min)):null;
  if(delay===null){
    const measured=stops.filter(s=>Number.isFinite(Number(s.actual))&&Number.isFinite(Number(s.scheduled))).sort((a,b)=>Number(b.actual)-Number(a.actual));
    if(measured.length){const s=measured[0];delay=Math.round((Number(s.actual)-Number(s.scheduled))/60000);}
  }
  if(delay!==null){t.delay_min=delay;t.delay_known=true;t.delay_text=delay===0?'in orario':(delay>0?'+'+delay+' min':delay+' min');}

  let station=clean(t.last_detection_station);if(station==='--')station='';
  let at=millis(t.last_detection_at),time=clean(t.last_detection_time);
  if(!station||!at||!time){
    const measured=stops.filter(s=>Number.isFinite(Number(s.actual))).sort((a,b)=>Number(b.actual)-Number(a.actual));
    const latest=measured[0];
    if(latest){
      if(!station)station=clean(latest.name);
      if(!at)at=millis(latest.actual);
      if(!time)time=fmt(at);
    }
  }
  t.origin=origin;t.destination=destination;t.route_name=`${origin} → ${destination}`;
  t.last_detection_station=station||null;t.last_detection_at=at||null;t.last_detection_time=time||null;
  t.last_detection_text=station&&time?`${station} · ${time}`:station||time||null;
  t.route_verified_from_stops=Boolean(first&&last);
  return t;
}
function normalizePayload(x){if(!x||!Array.isArray(x.trips))return x;return{...x,trips:x.trips.map(normalizeTrain)}}
module.exports={normalizeTrain,normalizePayload};
