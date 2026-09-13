
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
    console.log('✅ KV متصل - الحفظ الدائم مفعل - شهر مجاني مفعل');
  } catch(e){ console.error('KV init error', e); }
}

const DEFAULT_RESTAURANTS = [
  { id: 'rest_1', name: 'سفيرة - قرقارش', package: 'الاحترافية - 199 د.ل', price: 199, originalPrice:199, status: 'نشطة', expiry: '2026-10-15', remainingDays: 32, mrr: 199 },
  { id: 'rest_2', name: 'كازا باستا - بن عاشور', package: 'البداية - 99 د.ل', price: 99, originalPrice:99, status: 'تجربة مجانية', expiry: '2026-09-16', remainingDays: 3, mrr: 0, isTrial:true, trialDays:30 },
  { id: 'rest_3', name: 'برجر هاوس - السياحية', package: 'المؤسسي - 399 د.ل', price: 399, originalPrice:399, status: 'نشطة', expiry: '2026-12-01', remainingDays: 79, mrr: 399 },
];

let memoryCache = { restaurants: DEFAULT_RESTAURANTS, orders: [] };

function calcRemaining(expiryStr){
  try{
    const expiry = new Date(expiryStr);
    const now = new Date();
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
        // update remaining days dynamically
        memoryCache.restaurants = memoryCache.restaurants.map(r=>({...r, remainingDays: calcRemaining(r.expiry)}));
        return memoryCache; 
      }
    } catch(e){ console.error('kv get error', e); }
  }
  try {
    if (fs.existsSync(path.join(__dirname,'data.json'))) {
      const fileData = JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
      if (Array.isArray(fileData)) memoryCache.restaurants = fileData;
      else if (fileData.restaurants) memoryCache = fileData;
    }
  } catch(e){}
  memoryCache.restaurants = memoryCache.restaurants.map(r=>({...r, remainingDays: calcRemaining(r.expiry)}));
  return memoryCache;
}

async function saveAllData(data){
  memoryCache = data;
  if (kv) {
    try { await kv.set('qaima_full_data', data); } catch(e){ console.error('kv set error', e); }
  }
  try {
    fs.writeFileSync(path.join(__dirname,'data.json'), JSON.stringify(data.restaurants||[],null,2));
  } catch(e){}
}

app.get('/api/health', async (req,res)=>{
  const data = await getAllData();
  res.json({ ok:true, mode: kvMode, hasKV: !!kv, freeTrialEnabled:true, trialDays:30, restaurants: data.restaurants.length, time: new Date().toISOString() });
});

app.get('/api/data', async (req,res)=>{ res.json(await getAllData()); });
app.get('/api/restaurants', async (req,res)=>{ const d=await getAllData(); res.json(d.restaurants||[]); });

// إنشاء مطعم جديد = شهر مجاني تلقائي
app.post('/api/restaurants', async (req,res)=>{
  const data = await getAllData();
  const { name, price, package: pkg } = req.body;
  if (!name) return res.status(400).json({error:'name required'});
  const originalPrice = Number(price)||99;
  const expiryDate = new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0];
  const newRest = {
    id: 'rest_'+Date.now(),
    name,
    package: pkg || `الباقة - ${originalPrice} د.ل`,
    price: 0, // مجاني أول شهر
    originalPrice,
    status: 'تجربة مجانية',
    expiry: expiryDate,
    remainingDays: 30,
    mrr: 0,
    isTrial: true,
    trialDays: 30,
    freeMonth: true,
    createdAt: new Date().toISOString()
  };
  data.restaurants = data.restaurants||[];
  data.restaurants.push(newRest);
  await saveAllData(data);
  res.json(newRest);
});

// تفعيل الاشتراك بعد الشهر المجاني (تحويل من تجربة إلى نشطة)
app.post('/api/restaurants/:id/activate', async (req,res)=>{
  const data = await getAllData();
  const rest = data.restaurants.find(r=>r.id===req.params.id);
  if(!rest) return res.status(404).json({error:'not found'});
  rest.status='نشطة';
  rest.price=rest.originalPrice||rest.price;
  rest.mrr=rest.originalPrice||rest.price;
  rest.isTrial=false;
  rest.freeMonth=false;
  rest.expiry = new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0];
  rest.remainingDays=30;
  await saveAllData(data);
  res.json(rest);
});

app.delete('/api/restaurants/:id', async (req,res)=>{
  const data = await getAllData();
  data.restaurants = (data.restaurants||[]).filter(r=>r.id!==req.params.id);
  await saveAllData(data);
  res.json({ok:true});
});

app.get('/api/stats', async (req,res)=>{
  const data = await getAllData();
  const rests = data.restaurants||[];
  const active = rests.filter(r=>r.status==='نشطة').length;
  const trial = rests.filter(r=>r.status?.includes('تجربة')).length;
  const expired = rests.filter(r=>r.status?.includes('منتهي')||r.status?.includes('موقوف')||r.remainingDays===0).length;
  const mrr = rests.filter(r=>r.status==='نشطة').reduce((s,r)=>s+(r.mrr||r.price||0),0);
  res.json({ active, trial, expired, mrr, total: rests.length, freeTrialEnabled:true });
});

app.get('*', (req,res)=>{ res.sendFile(path.join(__dirname,'public','index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Qaima Super Admin - شهر مجاني مفعل -', PORT, kvMode));
