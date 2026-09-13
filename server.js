
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname, 'public')));

// --- KV Detection - يتعرف على أي اسم ---
function getEnvContaining(substr) {
  const key = Object.keys(process.env).find(k => k.toUpperCase().includes(substr.toUpperCase()));
  return key ? process.env[key] : null;
}
const KV_URL = process.env.KV_REST_API_URL || process.env.kv_KV_REST_API_URL || getEnvContaining('KV_REST_API_URL') || process.env.UPSTASH_REDIS_REST_URL || getEnvContaining('REDIS_REST_URL');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.kv_KV_REST_API_TOKEN || getEnvContaining('KV_REST_API_TOKEN') || process.env.UPSTASH_REDIS_REST_TOKEN || getEnvContaining('REDIS_REST_TOKEN');

console.log('ENV check KV:', { hasUrl: !!KV_URL, hasToken: !!KV_TOKEN, keys: Object.keys(process.env).filter(k=>k.toLowerCase().includes('kv')||k.toLowerCase().includes('redis')).slice(0,10) });

let kv = null;
let kvMode = 'memory';
if (KV_URL && KV_TOKEN) {
  try {
    const { Redis } = require('@upstash/redis');
    kv = new Redis({ url: KV_URL, token: KV_TOKEN });
    kvMode = 'upstash-kv';
    console.log('✅ KV متصل - الحفظ الدائم مفعل');
  } catch(e){ console.error('KV init error', e); }
} else {
  console.log('⚠️ KV not found - مؤقت');
}

// --- Data handling with migration from old JSON files ---
const DEFAULT_RESTAURANTS = [
  { id: 'rest_1', name: 'سفيرة - قرقارش', package: 'الاحترافية - 199 د.ل', price: 199, status: 'نشطة', expiry: '2026-10-15', remainingDays: 32, mrr: 199 },
  { id: 'rest_2', name: 'كازا باستا - بن عاشور', package: 'البداية - 99 د.ل', price: 99, status: 'تجربة مجانية', expiry: '2026-09-16', remainingDays: 3, mrr: 9 },
  { id: 'rest_3', name: 'برجر هاوس - السياحية', package: 'المؤسسي - 399 د.ل', price: 399, status: 'نشطة', expiry: '2026-12-01', remainingDays: 79, mrr: 399 },
];

let memoryCache = { restaurants: DEFAULT_RESTAURANTS, orders: [] };

async function getAllData(){
  if (kv) {
    try {
      const data = await kv.get('qaima_full_data');
      if (data && data.restaurants) { memoryCache = data; return data; }
      // migration: try old keys
      const oldRest = await kv.get('qaima_restaurants');
      if (oldRest) { memoryCache.restaurants = oldRest; await saveAllData(memoryCache); return memoryCache; }
    } catch(e){ console.error('kv get error', e); }
  }
  // try read old files for first migration
  try {
    if (fs.existsSync(path.join(__dirname,'data.json'))) {
      const fileData = JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
      if (Array.isArray(fileData)) memoryCache.restaurants = fileData;
      else if (fileData.restaurants) memoryCache = fileData;
    }
    if (fs.existsSync(path.join(__dirname,'orders.json'))) {
      memoryCache.orders = JSON.parse(fs.readFileSync(path.join(__dirname,'orders.json'),'utf8'));
    }
  } catch(e){}
  return memoryCache;
}

async function saveAllData(data){
  memoryCache = data;
  if (kv) {
    try { await kv.set('qaima_full_data', data); } catch(e){ console.error('kv set error', e); }
  }
  // also try save to disk (won't persist on Vercel but ok locally)
  try {
    fs.writeFileSync(path.join(__dirname,'data.json'), JSON.stringify(data.restaurants||[],null,2));
    fs.writeFileSync(path.join(__dirname,'orders.json'), JSON.stringify(data.orders||[],null,2));
  } catch(e){}
}

// --- APIs ---
app.get('/api/health', async (req,res)=>{
  const data = await getAllData();
  res.json({ ok:true, mode: kvMode, hasKV: !!kv, restaurants: data.restaurants.length, orders: data.orders.length, time: new Date().toISOString() });
});

app.get('/api/data', async (req,res)=>{
  const data = await getAllData();
  res.json(data);
});

app.get('/api/restaurants', async (req,res)=>{
  const data = await getAllData();
  res.json(data.restaurants||[]);
});

app.post('/api/restaurants', async (req,res)=>{
  const data = await getAllData();
  const { name, price, package: pkg } = req.body;
  if (!name) return res.status(400).json({error:'name required'});
  const newRest = {
    id: 'rest_'+Date.now(),
    name,
    package: pkg || `الباقة - ${price||99} د.ل`,
    price: Number(price)||99,
    status: 'نشطة',
    expiry: new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0],
    remainingDays: 30,
    mrr: Number(price)||99,
    createdAt: new Date().toISOString()
  };
  data.restaurants = data.restaurants||[];
  data.restaurants.push(newRest);
  await saveAllData(data);
  res.json(newRest);
});

app.delete('/api/restaurants/:id', async (req,res)=>{
  const data = await getAllData();
  data.restaurants = (data.restaurants||[]).filter(r=>r.id!==req.params.id);
  await saveAllData(data);
  res.json({ok:true});
});

app.get('/api/orders', async (req,res)=>{
  const data = await getAllData();
  res.json(data.orders||[]);
});

app.post('/api/orders', async (req,res)=>{
  const data = await getAllData();
  const order = { id: 'ord_'+Date.now(), ...req.body, createdAt: new Date().toISOString() };
  data.orders = data.orders||[];
  data.orders.push(order);
  await saveAllData(data);
  res.json(order);
});

app.get('/api/stats', async (req,res)=>{
  const data = await getAllData();
  const rests = data.restaurants||[];
  const active = rests.filter(r=>r.status==='نشطة').length;
  const trial = rests.filter(r=>r.status?.includes('تجربة')).length;
  const expired = rests.filter(r=>r.status?.includes('منتهي')||r.status?.includes('موقوف')).length;
  const mrr = rests.reduce((s,r)=>s+(r.mrr||r.price||0),0);
  res.json({ active, trial, expired, mrr, total: rests.length });
});

app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Qaima Super Admin running on', PORT, 'mode', kvMode));
