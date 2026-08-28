function clean(v){return String(v??'').trim().replace(/\s+/g,' ')}
function key(v){return clean(v).toUpperCase().replace(/&NBSP;/g,' ')}
function millis(v){const n=Number(v);if(!Number.isFinite(n))return null;if(n>1000000000000)return n;if(n>1000000000)return n*1000;return null}
function fmt(ts){const n=millis(ts);return n?new Date(n).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Europe/Rome'}):null}
function categoryGroup(code){const c=clean(code).toUpperCase();if(/^(EC|EN|NJ|RJ|TGV|THA|ICE|EIC|RJT|IC2|IR)/.test(c))return'INTL';if(/^(FR|FA|FB|AV)/.test(c))return'AV';if(/^IC/.test(c))return'IC';if(c==='RV')return'RV';if(/^MXP/.test(c))return'MXP';if(/^SFM/.test(c))return'REG';return'REG'}
function isMilanTorino(origin,destination){const a=key(origin),b=key(destination);return /MILANO/.test(a)&&/TORINO/.test(b)||/TORINO/.test(a)&&/MILANO/.test(b)}
function normalizeTrain(t){
  if(!t||typeof t!=='object')return t;
  const stops=Array.isArray(t.stops)?[...t.stops].filter(s=>s&&clean(s.name)).sort((a,b)=>(Number(a.seq)||0)-(Number(b.seq)||0)):[];
  const names=new Set(stops.map(s=>key(s.name)));
  const first=stops[0],last=stops.at(-1);
  let origin=clean(t.origin),destination=clean(t.destination);
  const foreignOrigin=clean(t.origin_foreign),foreignDestination=clean(t.destination_foreign);
  if(first&&last&&key(first.name)!==key(last.name)){origin=clean(first.name);destination=clean(last.name)}
  if(foreignOrigin&&!names.has(key(foreignOrigin)))origin=foreignOrigin;
  if(foreignDestination&&!names.has(key(foreignDestination)))destination=foreignDestination;
  if(!origin&&first)origin=clean(first.name);
  if(!destination&&last)destination=clean(last.name);
  let verifiedCategory=clean(t.verified_category||t.category).toUpperCase();
  const n=Number(t.verified_train_number||t.train_number);
  if(Number.isInteger(n)&&n>=2000&&n<2100&&isMilanTorino(origin,destination))verifiedCategory='RV';
  if(verifiedCategory==='REGIONALE VELOCE')verifiedCategory='RV';
  if(/^SFM/.test(verifiedCategory))verifiedCategory='REG';
  t.verified_category=verifiedCategory||t.verified_category||t.category||null;
  t.category=t.verified_category||t.category;
  let delay=Number.isFinite(Number(t.delay_min))?Math.round(Number(t.delay_min)):null;
  const delayText=clean(t.delay_text);
  if(delay===null&&/in\s*orario|puntuale|on\s*time/i.test(delayText))delay=0;
  if(delay===null){const measured=stops.filter(s=>Number.isFinite(Number(s.actual))&&Number.isFinite(Number(s.scheduled))).sort((a,b)=>Number(b.actual)-Number(a.actual));if(measured.length){const s=measured[0];delay=Math.round((Number(s.actual)-Number(s.scheduled))/60000)}}
  if(delay!==null){t.delay_min=delay;t.delay_known=true;t.delay_text=delay===0?'in orario':(delay>0?'+'+delay+' min':delay+' min')}
  let station=clean(t.last_detection_station);if(station==='--')station='';
  let at=millis(t.last_detection_at),time=clean(t.last_detection_time);
  if(!station||!at||!time){const measured=stops.filter(s=>Number.isFinite(Number(s.actual))).sort((a,b)=>Number(b.actual)-Number(a.actual));const latest=measured[0];if(latest){if(!station)station=clean(latest.name);if(!at)at=millis(latest.actual);if(!time)time=fmt(at)}}
  if(!time&&at)time=fmt(at);
  t.origin=origin;t.destination=destination;t.route_name=`${origin} → ${destination}`;
  t.category_group=categoryGroup(t.verified_category||t.category||'');
  t.display_train_label=`${t.verified_category||t.category||''} ${t.verified_train_number||t.train_number||''}`.trim();
  t.last_detection_station=station||null;t.last_detection_at=at||null;t.last_detection_time=time||null;
  t.last_detection_text=station&&time?`${station} · ${time}`:station||time||null;
  t.route_verified_from_stops=Boolean(first&&last);
  return t;
}
function normalizePayload(x){if(!x||!Array.isArray(x.trips))return x;return{...x,trips:x.trips.map(normalizeTrain)}}
module.exports={normalizeTrain,normalizePayload};
