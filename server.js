
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- KV Detection (robust for any prefix) ----
function getEnvContaining(substr) {
  const key = Object.keys(process.env).find(k => k.toUpperCase().includes(substr.toUpperCase()));
  return key ? process.env[key] : null;
}

const KV_URL = process.env.KV_REST_API_URL || process.env.kv_KV_REST_API_URL || process.env.KV_KV_REST_API_URL || getEnvContaining('KV_REST_API_URL') || process.env.UPSTASH_REDIS_REST_URL || process.env.kv_UPSTASH_REDIS_REST_URL || getEnvContaining('REDIS_REST_URL');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.kv_KV_REST_API_TOKEN || process.env.KV_KV_REST_API_TOKEN || getEnvContaining('KV_REST_API_TOKEN') || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.kv_UPSTASH_REDIS_REST_TOKEN || getEnvContaining('REDIS_REST_TOKEN');

console.log('ENV check:', { hasUrl: !!KV_URL, hasToken: !!KV_TOKEN, keys: Object.keys(process.env).filter(k=>k.toLowerCase().includes('kv') || k.toLowerCase().includes('redis') || k.toLowerCase().includes('upstash')) });

let kv = null;
let kvMode = 'memory';
if (KV_URL && KV_TOKEN) {
  try {
    const { Redis } = require('@upstash/redis');
    kv = new Redis({ url: KV_URL, token: KV_TOKEN });
    kvMode = 'upstash';
    console.log('✅ Vercel KV متصل - البيانات ستحفظ للأبد - mode:', kvMode);
  } catch(e) {
    console.error('KV init failed, fallback to memory', e);
  }
} else {
  console.log('⚠️ KV not found - using memory (مؤقت)');
}

// Fallback memory
let memoryOrders = [];
let memoryRestaurants = [
  { id: 'rest_1', name: 'مطعم القيمة التجريبي', price: 5, active: true }
];

async function getRestaurants() {
  if (kv) {
    try {
      const data = await kv.get('qaima_restaurants');
      return data || memoryRestaurants;
    } catch(e){ return memoryRestaurants; }
  }
  return memoryRestaurants;
}
async function saveRestaurants(list) {
  memoryRestaurants = list;
  if (kv) { try { await kv.set('qaima_restaurants', list); } catch(e){} }
}

async function getOrders() {
  if (kv) {
    try {
      const data = await kv.get('qaima_orders');
      return data || [];
    } catch(e){ return memoryOrders; }
  }
  return memoryOrders;
}
async function saveOrders(list) {
  memoryOrders = list;
  if (kv) { try { await kv.set('qaima_orders', list); } catch(e){} }
}

// API
app.get('/api/health', async (req,res)=>{
  res.json({ ok:true, mode: kvMode, hasKV: !!kv, time: new Date().toISOString() });
});

app.get('/api/restaurants', async (req,res)=>{
  const list = await getRestaurants();
  res.json(list);
});

app.post('/api/restaurants', async (req,res)=>{
  const { name, price } = req.body;
  if (!name) return res.status(400).json({error:'name required'});
  const list = await getRestaurants();
  const newRest = { id: 'rest_'+Date.now(), name, price: Number(price)||5, active: true, createdAt: new Date().toISOString() };
  list.push(newRest);
  await saveRestaurants(list);
  console.log('Restaurant added:', newRest);
  res.json(newRest);
});

app.delete('/api/restaurants/:id', async (req,res)=>{
  let list = await getRestaurants();
  list = list.filter(r=>r.id!==req.params.id);
  await saveRestaurants(list);
  res.json({ok:true});
});

app.get('/api/orders', async (req,res)=>{
  const orders = await getOrders();
  res.json(orders);
});

app.post('/api/orders', async (req,res)=>{
  const orders = await getOrders();
  const order = { id: 'ord_'+Date.now(), ...req.body, createdAt: new Date().toISOString() };
  orders.push(order);
  await saveOrders(orders);
  res.json(order);
});

app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Qaima running on', PORT));
