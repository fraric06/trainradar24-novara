process.env.TZ='Europe/Rome';
const https=require('https');

const REGION_URL='https://webgis.arpa.piemonte.it/server/rest/services/topografia_dati_di_base/Limiti_amministrativi/MapServer/5/query?where=cod_reg%3D1&outFields=cod_reg%2Cregione&returnGeometry=true&outSR=4326&f=geojson';

let geometry=null;
let loadPromise=null;
let boundaryReady=false;

function request(url,timeout=15000){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{'User-Agent':'TrainRadar24-Piemonte/1.0','Accept':'application/geo+json,application/json,*/*','Connection':'close'}},res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',c=>body+=c);
      res.on('end',()=>{
        if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(body);
      });
    });
    req.setTimeout(timeout,()=>req.destroy(new Error(`timeout ${timeout}ms`)));
    req.on('error',reject);
  });
}

function pointInRing(lon,lat,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=Number(ring[i][0]),yi=Number(ring[i][1]);
    const xj=Number(ring[j][0]),yj=Number(ring[j][1]);
    if(!Number.isFinite(xi)||!Number.isFinite(yi)||!Number.isFinite(xj)||!Number.isFinite(yj))continue;
    const hit=((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/(yj-yi)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}

function pointInPolygon(lon,lat,polygon){
  if(!Array.isArray(polygon)||!polygon.length||!pointInRing(lon,lat,polygon[0]))return false;
  for(let i=1;i<polygon.length;i++)if(pointInRing(lon,lat,polygon[i]))return false;
  return true;
}

function pointInGeometry(lon,lat,g){
  if(!g)return false;
  if(g.type==='Polygon')return pointInPolygon(lon,lat,g.coordinates);
  if(g.type==='MultiPolygon')return g.coordinates.some(p=>pointInPolygon(lon,lat,p));
  return false;
}

async function loadBoundary(){
  if(boundaryReady)return true;
  if(loadPromise)return loadPromise;
  loadPromise=(async()=>{
    try{
      const data=JSON.parse(await request(REGION_URL));
      const feature=(data.features||[]).find(f=>f?.geometry);
      geometry=feature?.geometry||null;
      boundaryReady=Boolean(geometry);
      if(!boundaryReady)throw new Error('GeoJSON Piemonte vuoto');
      console.log('Confine Piemonte caricato da ARPA Piemonte');
      return true;
    }catch(e){
      console.error('Confine Piemonte non disponibile:',e.message);
      boundaryReady=false;
      return false;
    }finally{
      loadPromise=null;
    }
  })();
  return loadPromise;
}

async function filterTrips(trips){
  if(!Array.isArray(trips)||!trips.length)return[];
  const ok=await loadBoundary();
  if(!ok)return trips;
  return trips.filter(t=>{
    const lat=Number(t.lat),lon=Number(t.lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&pointInGeometry(lon,lat,geometry);
  });
}

module.exports={loadBoundary,filterTrips};
