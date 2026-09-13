
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
  } catch(e){}
}

const DEFAULT_MENUS = {
  'rest_1': [
    {id:'m1', name:'بيتزا مارغريتا', price:45, category:'بيتزا', desc:'صلصة طماطم، جبنة موزاريلا طازجة، ريحان', available:true},
    {id:'m2', name:'بيتزا بيبروني', price:55, category:'بيتزا', desc:'بيبروني حار، جبنة إضافية', available:true},
    {id:'m3', name:'برجر كلاسيك', price:35, category:'برجر', desc:'لحم أنجوس، خس، طماطم، صوص خاص', available:true},
    {id:'m4', name:'باستا ألفريدو', price:48, category:'باستا', desc:'كريمة، دجاج، فطر، بارميزان', available:true},
  ],
  'rest_2': [
    {id:'m5', name:'سباغيتي بولونيز', price:38, category:'باستا', desc:'صلصة لحم، طماطم، ريحان', available:true},
    {id:'m6', name:'لازانيا', price:42, category:'باستا', desc:'طبقات لحم وجبنة', available:true},
  ],
  'rest_3': [
    {id:'m7', name:'برجر دبل تشيز', price:52, category:'برجر', desc:'قطعتين لحم، دبل تشيز', available:true},
    {id:'m8', name:'بطاطا مقلية', price:15, category:'مقبلات', desc:'مقرمشة وذهبية', available:true},
  ]
};

const DEFAULT_RESTAURANTS = [
  { id: 'rest_1', name: 'سفيرة - قرقارش', phone:'0912345678', package: 'الاحترافية - 199 د.ل', price: 199, originalPrice:199, status: 'نشطة', expiry: '2026-10-15', remainingDays: 32, mrr: 199 },
  { id: 'rest_2', name: 'كازا باستا - بن عاشور', phone:'0923456789', package: 'البداية - 99 د.ل', price: 99, originalPrice:99, status: 'تجربة مجانية', expiry: '2026-09-16', remainingDays: 3, mrr: 0, isTrial:true },
  { id: 'rest_3', name: 'برجر هاوس - السياحية', phone:'0934567890', package: 'المؤسسي - 399 د.ل', price: 399, originalPrice:399, status: 'نشطة', expiry: '2026-12-01', remainingDays: 79, mrr: 399 },
];

let memoryCache = { restaurants: DEFAULT_RESTAURANTS, orders: [], menus: DEFAULT_MENUS };

function calcRemaining(expiryStr){
  try{ const e=new Date(expiryStr); const n=new Date(); n.setHours(0,0,0,0); e.setHours(0,0,0,0); const diff=Math.ceil((e-n)/(1000*60*60*24)); return diff>0?diff:0; }catch{return 0}
}

async function getAllData(){
  if(kv){ try{ const d=await kv.get('qaima_full_data'); if(d&&d.restaurants){ memoryCache=d; if(!memoryCache.menus) memoryCache.menus=DEFAULT_MENUS; memoryCache.restaurants=memoryCache.restaurants.map(r=>({...r,remainingDays:calcRemaining(r.expiry)})); return memoryCache; } }catch(e){} }
  try{ if(fs.existsSync(path.join(__dirname,'data.json'))){ const d=JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8')); if(Array.isArray(d)) memoryCache.restaurants=d; else if(d.restaurants) memoryCache=d; if(!memoryCache.menus) memoryCache.menus=DEFAULT_MENUS; } }catch{}
  memoryCache.restaurants=memoryCache.restaurants.map(r=>({...r,remainingDays:calcRemaining(r.expiry)}));
  return memoryCache;
}
async function saveAllData(data){ memoryCache=data; if(kv){ try{ await kv.set('qaima_full_data', data); }catch(e){} } try{ fs.writeFileSync(path.join(__dirname,'data.json'), JSON.stringify(data,null,2)); }catch(e){} }

// --- APIs ---
app.get('/api/health', async (req,res)=>{ const d=await getAllData(); res.json({ok:true,hasKV:!!kv,mode:kvMode,restaurants:d.restaurants.length}); });
app.get('/api/data', async (req,res)=> res.json(await getAllData()));
app.get('/api/restaurants', async (req,res)=>{ const d=await getAllData(); res.json(d.restaurants); });
app.get('/api/restaurants/:id', async (req,res)=>{ const d=await getAllData(); const r=d.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({error:'not found'}); res.json(r); });

app.post('/api/restaurants', async (req,res)=>{
  const data=await getAllData(); const {name,phone,price,package:pkg}=req.body; if(!name) return res.status(400).json({error:'name'});
  const orig=Number(price)||99; const expiry=new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0];
  const nr={id:'rest_'+Date.now(),name,phone:phone||'',package:pkg||`${orig} د.ل`,price:0,originalPrice:orig,status:'تجربة مجانية',expiry,remainingDays:30,mrr:0,isTrial:true,createdAt:new Date().toISOString()};
  data.restaurants.push(nr); if(!data.menus) data.menus={}; data.menus[nr.id]=[]; await saveAllData(data); res.json(nr);
});
app.put('/api/restaurants/:id', async (req,res)=>{ const data=await getAllData(); const i=data.restaurants.findIndex(x=>x.id===req.params.id); if(i===-1) return res.status(404).json({}); data.restaurants[i]={...data.restaurants[i],...req.body,remainingDays:req.body.expiry?calcRemaining(req.body.expiry):data.restaurants[i].remainingDays}; await saveAllData(data); res.json(data.restaurants[i]); });
app.post('/api/restaurants/:id/extend', async (req,res)=>{ const data=await getAllData(); const r=data.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({}); const {days,expiry}=req.body; if(expiry) r.expiry=expiry; else if(days){ const b=new Date(r.expiry); b.setDate(b.getDate()+Number(days)); r.expiry=b.toISOString().split('T')[0]; } r.remainingDays=calcRemaining(r.expiry); if(r.remainingDays>0&&r.status.includes('منتهي')) r.status='نشطة'; await saveAllData(data); res.json(r); });
app.post('/api/restaurants/:id/status', async (req,res)=>{ const data=await getAllData(); const r=data.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({}); r.status=req.body.status; if(r.status==='نشطة'){r.price=r.originalPrice;r.mrr=r.originalPrice;r.isTrial=false;} if(r.status.includes('تجربة')){r.price=0;r.mrr=0;r.isTrial=true;} if(r.status==='موقوفة'||r.status.includes('منتهي')) r.mrr=0; await saveAllData(data); res.json(r); });
app.post('/api/restaurants/:id/plan', async (req,res)=>{ const data=await getAllData(); const r=data.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({}); r.originalPrice=Number(req.body.price); r.package=req.body.package; if(r.status==='نشطة'){r.price=Number(req.body.price); r.mrr=Number(req.body.price);} await saveAllData(data); res.json(r); });
app.post('/api/restaurants/:id/activate', async (req,res)=>{ const data=await getAllData(); const r=data.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({}); r.status='نشطة'; r.price=r.originalPrice; r.mrr=r.originalPrice; r.isTrial=false; r.expiry=new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0]; r.remainingDays=30; await saveAllData(data); res.json(r); });
app.post('/api/restaurants/:id/toggle', async (req,res)=>{ const data=await getAllData(); const r=data.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({}); if(r.status==='موقوفة'){r.status='نشطة'; r.mrr=r.originalPrice;} else {r.status='موقوفة'; r.mrr=0;} await saveAllData(data); res.json(r); });
app.delete('/api/restaurants/:id', async (req,res)=>{ const data=await getAllData(); data.restaurants=data.restaurants.filter(x=>x.id!==req.params.id); if(data.menus) delete data.menus[req.params.id]; await saveAllData(data); res.json({ok:true}); });
app.get('/api/stats', async (req,res)=>{ const d=await getAllData(); const rests=d.restaurants; const active=rests.filter(r=>r.status==='نشطة').length; const trial=rests.filter(r=>r.status?.includes('تجربة')).length; const stopped=rests.filter(r=>r.status==='موقوفة').length; const expired=rests.filter(r=>r.status?.includes('منتهي')||r.remainingDays===0).length; const mrr=rests.filter(r=>r.status==='نشطة').reduce((s,r)=>s+(r.mrr||0),0); res.json({active,trial,stopped,expired,mrr,total:rests.length}); });

// Menus APIs
app.get('/api/restaurants/:id/menu', async (req,res)=>{ const data=await getAllData(); const menu=(data.menus&&data.menus[req.params.id])||[]; res.json(menu); });
app.post('/api/restaurants/:id/menu', async (req,res)=>{ const data=await getAllData(); if(!data.menus) data.menus={}; if(!data.menus[req.params.id]) data.menus[req.params.id]=[]; const item={id:'item_'+Date.now(),...req.body,available:true}; data.menus[req.params.id].push(item); await saveAllData(data); res.json(item); });
app.put('/api/restaurants/:id/menu/:itemId', async (req,res)=>{ const data=await getAllData(); const menu=data.menus[req.params.id]||[]; const idx=menu.findIndex(x=>x.id===req.params.itemId); if(idx===-1) return res.status(404).json({}); menu[idx]={...menu[idx],...req.body}; await saveAllData(data); res.json(menu[idx]); });
app.delete('/api/restaurants/:id/menu/:itemId', async (req,res)=>{ const data=await getAllData(); if(data.menus&&data.menus[req.params.id]) data.menus[req.params.id]=data.menus[req.params.id].filter(x=>x.id!==req.params.itemId); await saveAllData(data); res.json({ok:true}); });

// Orders
app.get('/api/orders', async (req,res)=>{ const d=await getAllData(); let orders=d.orders||[]; if(req.query.restaurant) orders=orders.filter(o=>o.restaurantId===req.query.restaurant); res.json(orders); });
app.post('/api/orders', async (req,res)=>{ const data=await getAllData(); const order={id:'ord_'+Date.now(),...req.body,createdAt:new Date().toISOString(),status:'جديد'}; data.orders=data.orders||[]; data.orders.push(order); await saveAllData(data); res.json(order); });
app.put('/api/orders/:id', async (req,res)=>{ const data=await getAllData(); const idx=data.orders.findIndex(o=>o.id===req.params.id); if(idx===-1) return res.status(404).json({}); data.orders[idx]={...data.orders[idx],...req.body}; await saveAllData(data); res.json(data.orders[idx]); });

// Public pages
app.get('/menu/:id', (req,res)=> res.sendFile(path.join(__dirname,'public','menu.html')));
app.get('/manage/:id', (req,res)=> res.sendFile(path.join(__dirname,'public','manage-menu.html')));
app.get('/admin', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Qaima full system running',PORT,kvMode));
