
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname, 'public')));

function getEnvContaining(substr) {
  const key = Object.keys(process.env).find(k => k.toUpperCase().includes(substr.toUpperCase()));
  return key ? process.env[key] : null;
}
const KV_URL = process.env.KV_REST_API_URL || process.env.kv_KV_REST_API_URL || getEnvContaining('KV_REST_API_URL') || process.env.UPSTASH_REDIS_REST_URL || getEnvContaining('REDIS_REST_URL');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.kv_KV_REST_API_TOKEN || getEnvContaining('KV_REST_API_TOKEN') || process.env.UPSTASH_REDIS_REST_TOKEN || getEnvContaining('REDIS_REST_TOKEN');

let kv = null;
let kvMode = 'memory';
if (KV_URL && KV_TOKEN) {
  try {
    const { Redis } = require('@upstash/redis');
    kv = new Redis({ url: KV_URL, token: KV_TOKEN });
    kvMode = 'upstash-kv';
    console.log('✅ KV متصل - Super Admin Pro');
  } catch(e){ console.error('KV error', e); }
}

const DEFAULT_RESTAURANTS = [
  { id: 'rest_1', name: 'سفيرة - قرقارش', phone:'0912345678', package: 'الاحترافية - 199 د.ل', price: 199, originalPrice:199, status: 'نشطة', expiry: '2026-10-15', remainingDays: 32, mrr: 199, notes:'' },
  { id: 'rest_2', name: 'كازا باستا - بن عاشور', phone:'0923456789', package: 'البداية - 99 د.ل', price: 99, originalPrice:99, status: 'تجربة مجانية', expiry: '2026-09-16', remainingDays: 3, mrr: 0, isTrial:true, freeMonth:true },
  { id: 'rest_3', name: 'برجر هاوس - السياحية', phone:'0934567890', package: 'المؤسسي - 399 د.ل', price: 399, originalPrice:399, status: 'نشطة', expiry: '2026-12-01', remainingDays: 79, mrr: 399 },
];

let memoryCache = { restaurants: DEFAULT_RESTAURANTS, orders: [] };

function calcRemaining(expiryStr){
  try{
    const expiry = new Date(expiryStr);
    const now = new Date(); now.setHours(0,0,0,0);
    expiry.setHours(0,0,0,0);
    const diff = Math.ceil((expiry - now)/(1000*60*60*24));
    return diff>0? diff : 0;
  }catch{ return 0 }
}

async function getAllData(){
  if (kv) {
    try {
      const data = await kv.get('qaima_full_data');
      if (data && data.restaurants) { 
        memoryCache = data;
        memoryCache.restaurants = memoryCache.restaurants.map(r=>({...r, remainingDays: calcRemaining(r.expiry)}));
        return memoryCache;
      }
    } catch(e){}
  }
  try {
    if (fs.existsSync(path.join(__dirname,'data.json'))) {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
      if (Array.isArray(d)) memoryCache.restaurants = d;
      else if (d.restaurants) memoryCache = d;
    }
  } catch{}
  memoryCache.restaurants = memoryCache.restaurants.map(r=>({...r, remainingDays: calcRemaining(r.expiry)}));
  return memoryCache;
}

async function saveAllData(data){
  memoryCache = data;
  if (kv) { try { await kv.set('qaima_full_data', data); } catch(e){} }
  try { fs.writeFileSync(path.join(__dirname,'data.json'), JSON.stringify(data.restaurants||[],null,2)); } catch(e){}
}

// APIs
app.get('/api/health', async (req,res)=>{
  const d = await getAllData();
  res.json({ ok:true, mode: kvMode, hasKV: !!kv, count:d.restaurants.length });
});

app.get('/api/data', async (req,res)=> res.json(await getAllData()));
app.get('/api/restaurants', async (req,res)=>{ const d=await getAllData(); res.json(d.restaurants); });
app.get('/api/restaurants/:id', async (req,res)=>{ const d=await getAllData(); const r=d.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({error:'not found'}); res.json(r); });

app.post('/api/restaurants', async (req,res)=>{
  const data = await getAllData();
  const { name, phone, price, package: pkg } = req.body;
  if (!name) return res.status(400).json({error:'name required'});
  const orig = Number(price)||99;
  const expiry = new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0];
  const nr = { id:'rest_'+Date.now(), name, phone:phone||'', package: pkg||`الباقة - ${orig} د.ل`, price:0, originalPrice:orig, status:'تجربة مجانية', expiry, remainingDays:30, mrr:0, isTrial:true, freeMonth:true, notes:'', createdAt:new Date().toISOString() };
  data.restaurants.push(nr);
  await saveAllData(data);
  res.json(nr);
});

app.put('/api/restaurants/:id', async (req,res)=>{
  const data = await getAllData();
  const idx = data.restaurants.findIndex(x=>x.id===req.params.id);
  if(idx===-1) return res.status(404).json({error:'not found'});
  const curr = data.restaurants[idx];
  const upd = req.body;
  data.restaurants[idx] = { ...curr, ...upd, remainingDays: upd.expiry? calcRemaining(upd.expiry) : curr.remainingDays };
  await saveAllData(data);
  res.json(data.restaurants[idx]);
});

app.post('/api/restaurants/:id/extend', async (req,res)=>{
  const data = await getAllData();
  const r = data.restaurants.find(x=>x.id===req.params.id);
  if(!r) return res.status(404).json({error:'not found'});
  const { days, expiry } = req.body;
  if(expiry){ r.expiry = expiry; }
  else if(days){
    const base = new Date(r.expiry); 
    base.setDate(base.getDate()+Number(days));
    r.expiry = base.toISOString().split('T')[0];
  }
  r.remainingDays = calcRemaining(r.expiry);
  if(r.remainingDays>0 && r.status.includes('منتهي')) r.status='نشطة';
  await saveAllData(data);
  res.json(r);
});

app.post('/api/restaurants/:id/status', async (req,res)=>{
  const data = await getAllData();
  const r = data.restaurants.find(x=>x.id===req.params.id);
  if(!r) return res.status(404).json({error:'not found'});
  r.status = req.body.status;
  if(r.status==='نشطة'){ r.price=r.originalPrice; r.mrr=r.originalPrice; r.isTrial=false; }
  if(r.status==='تجربة مجانية'){ r.price=0; r.mrr=0; r.isTrial=true; }
  if(r.status==='موقوفة' || r.status==='منتهي'){ r.mrr=0; }
  await saveAllData(data);
  res.json(r);
});

app.post('/api/restaurants/:id/plan', async (req,res)=>{
  const data = await getAllData();
  const r = data.restaurants.find(x=>x.id===req.params.id);
  if(!r) return res.status(404).json({error:'not found'});
  const { price, package: pkg } = req.body;
  r.originalPrice = Number(price);
  r.package = pkg;
  if(r.status==='نشطة'){ r.price=Number(price); r.mrr=Number(price); }
  await saveAllData(data);
  res.json(r);
});

app.post('/api/restaurants/:id/activate', async (req,res)=>{
  const data = await getAllData();
  const r = data.restaurants.find(x=>x.id===req.params.id);
  if(!r) return res.status(404).json({error:'not found'});
  r.status='نشطة'; r.price=r.originalPrice; r.mrr=r.originalPrice; r.isTrial=false; r.freeMonth=false;
  r.expiry = new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0];
  r.remainingDays=30;
  await saveAllData(data);
  res.json(r);
});

app.post('/api/restaurants/:id/toggle', async (req,res)=>{
  const data = await getAllData();
  const r = data.restaurants.find(x=>x.id===req.params.id);
  if(!r) return res.status(404).json({error:'not found'});
  if(r.status==='موقوفة'){ r.status='نشطة'; r.mrr=r.originalPrice; }
  else { r.status='موقوفة'; r.mrr=0; r._prevStatus='نشطة'; }
  await saveAllData(data);
  res.json(r);
});

app.delete('/api/restaurants/:id', async (req,res)=>{
  const data = await getAllData();
  data.restaurants = data.restaurants.filter(x=>x.id!==req.params.id);
  await saveAllData(data);
  res.json({ok:true});
});

app.get('/api/stats', async (req,res)=>{
  const d = await getAllData();
  const rests = d.restaurants;
  const active = rests.filter(r=>r.status==='نشطة').length;
  const trial = rests.filter(r=>r.status?.includes('تجربة')).length;
  const stopped = rests.filter(r=>r.status==='موقوفة').length;
  const expired = rests.filter(r=>r.status?.includes('منتهي')||r.remainingDays===0).length;
  const mrr = rests.filter(r=>r.status==='نشطة').reduce((s,r)=>s+(r.mrr||0),0);
  res.json({ active, trial, stopped, expired, mrr, total:rests.length });
});

app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Super Admin Pro running', PORT));
