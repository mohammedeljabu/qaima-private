
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname, 'public')));

// KV
function getEnvContaining(substr) {
  const key = Object.keys(process.env).find(k => k.toUpperCase().includes(substr.toUpperCase()));
  return key ? process.env[key] : null;
}
const KV_URL = process.env.KV_REST_API_URL || process.env.kv_KV_REST_API_URL || getEnvContaining('KV_REST_API_URL') || process.env.UPSTASH_REDIS_REST_URL || getEnvContaining('REDIS_REST_URL');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.kv_KV_REST_API_TOKEN || getEnvContaining('KV_REST_API_TOKEN') || process.env.UPSTASH_REDIS_REST_TOKEN || getEnvContaining('REDIS_REST_TOKEN');
let kv=null, kvMode='memory';
if(KV_URL && KV_TOKEN){
  try{ const {Redis}=require('@upstash/redis'); kv=new Redis({url:KV_URL, token:KV_TOKEN}); kvMode='upstash-kv'; console.log('✅ KV متصل - 3 منصات'); }catch(e){ console.error(e); }
}

function calcRemaining(exp){ try{ const e=new Date(exp); const n=new Date(); n.setHours(0,0,0,0); e.setHours(0,0,0,0); const d=Math.ceil((e-n)/86400000); return d>0?d:0; }catch{return 0} }

const DEFAULT_DATA = {
  restaurants: [
    {id:'rest_1', name:'سفيرة - قرقارش', ownerName:'أحمد', phone:'0911111111', password:'1234', package:'الاحترافية - 199 د.ل', price:199, originalPrice:199, status:'نشطة', expiry:'2026-10-15', remainingDays:32, mrr:199, tables:10, createdAt:new Date().toISOString()},
    {id:'rest_2', name:'كازا باستا', ownerName:'محمد', phone:'0922222222', password:'1234', package:'البداية - 99 د.ل', price:0, originalPrice:99, status:'تجربة مجانية', expiry:'2026-09-16', remainingDays:30, mrr:0, isTrial:true, tables:8, createdAt:new Date().toISOString()},
  ],
  menus: {
    'rest_1': [
      {id:'m1', name:'بيتزا مارغريتا', price:45, category:'بيتزا', desc:'طماطم، موزاريلا، ريحان', available:true},
      {id:'m2', name:'برجر كلاسيك', price:35, category:'برجر', desc:'لحم أنجوس، خس، صوص', available:true},
      {id:'m3', name:'باستا الفريدو', price:48, category:'باستا', desc:'دجاج، كريمة، فطر', available:true},
    ],
    'rest_2': [{id:'m4', name:'سباغيتي', price:38, category:'باستا', desc:'بولونيز', available:true}]
  },
  orders: []
};

let mem = JSON.parse(JSON.stringify(DEFAULT_DATA));

async function getData(){
  if(kv){
    try{
      const d=await kv.get('qaima_3platforms');
      if(d && d.restaurants && d.restaurants.length>0){
        mem=d;
        if(!mem.menus) mem.menus={};
        if(!mem.orders) mem.orders=[];
        mem.restaurants=mem.restaurants.map(r=>({...r, remainingDays:calcRemaining(r.expiry)}));
        return mem;
      }
      // ترحيل من المفتاح القديم
      const old=await kv.get('qaima_full_data');
      if(old && old.restaurants && old.restaurants.length>0){
        mem.restaurants=old.restaurants.map(r=>({ownerName:r.ownerName||'صاحب المطعم', phone:r.phone||'09'+Math.floor(Math.random()*100000000), password:r.password||'1234', tables:r.tables||10, ...r, remainingDays:calcRemaining(r.expiry)}));
        mem.menus=old.menus||mem.menus;
        mem.orders=old.orders||[];
        await saveData(mem);
        return mem;
      }
    }catch(e){ console.error('KV get err',e); }
  }
  if(!mem.restaurants || mem.restaurants.length===0) mem=JSON.parse(JSON.stringify(DEFAULT_DATA));
  mem.restaurants=mem.restaurants.map(r=>({...r, remainingDays:calcRemaining(r.expiry)}));
  return mem;
}

async function saveData(data){
  mem=data;
  if(!data.restaurants || data.restaurants.length===0){ console.log('⛔ منع حفظ فارغ'); return; }
  if(kv){ try{ await kv.set('qaima_3platforms', data); console.log('✅ حفظ', data.restaurants.length); }catch(e){ console.error(e); } }
  try{ fs.writeFileSync(path.join(__dirname,'data.json'), JSON.stringify(data,null,2)); }catch{}
}

// ---- API ----
app.get('/api/health', async (req,res)=>{ const d=await getData(); res.json({ok:true, kv:!!kv, mode:kvMode, restaurants:d.restaurants.length, orders:d.orders.length}); });
app.get('/api/debug', async (req,res)=>{ const d=await getData(); res.json({memRests:d.restaurants.length, kvMode, hasKV:!!kv}); });
app.get('/api/restore', async (req,res)=>{ mem=JSON.parse(JSON.stringify(DEFAULT_DATA)); await saveData(mem); res.json({ok:true, restored:mem.restaurants.length}); });

// Super Admin - Restaurants
app.get('/api/restaurants', async (req,res)=>{ const d=await getData(); res.json(d.restaurants); });
app.get('/api/restaurants/:id', async (req,res)=>{ const d=await getData(); const r=d.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({}); res.json(r); });
app.post('/api/restaurants', async (req,res)=>{
  const d=await getData();
  const {name, ownerName, phone, password, package: pkg, price, tables} = req.body;
  if(!name||!phone||!password) return res.status(400).json({error:'name phone password required'});
  if(d.restaurants.find(x=>x.phone===phone)) return res.status(400).json({error:'phone exists'});
  const orig=Number(price)||99;
  const expiry=new Date(Date.now()+30*86400000).toISOString().split('T')[0];
  const nr={id:'rest_'+Date.now(), name, ownerName:ownerName||'', phone, password, package:pkg||`${orig} د.ل`, price:0, originalPrice:orig, status:'تجربة مجانية', expiry, remainingDays:30, mrr:0, isTrial:true, freeMonth:true, tables:Number(tables)||10, createdAt:new Date().toISOString()};
  d.restaurants.push(nr);
  if(!d.menus) d.menus={};
  d.menus[nr.id]=[];
  await saveData(d);
  res.json(nr);
});
app.put('/api/restaurants/:id', async (req,res)=>{ const d=await getData(); const i=d.restaurants.findIndex(x=>x.id===req.params.id); if(i===-1) return res.status(404).json({}); d.restaurants[i]={...d.restaurants[i], ...req.body, remainingDays:req.body.expiry?calcRemaining(req.body.expiry):d.restaurants[i].remainingDays}; await saveData(d); res.json(d.restaurants[i]); });
app.delete('/api/restaurants/:id', async (req,res)=>{ const d=await getData(); d.restaurants=d.restaurants.filter(x=>x.id!==req.params.id); if(d.menus) delete d.menus[req.params.id]; await saveData(d); res.json({ok:true}); });
app.post('/api/restaurants/:id/extend', async (req,res)=>{ const d=await getData(); const r=d.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({}); const {days, expiry}=req.body; if(expiry) r.expiry=expiry; else if(days){ const b=new Date(r.expiry); b.setDate(b.getDate()+Number(days)); r.expiry=b.toISOString().split('T')[0]; } r.remainingDays=calcRemaining(r.expiry); if(r.remainingDays>0 && r.status.includes('منتهي')) r.status='نشطة'; await saveData(d); res.json(r); });
app.post('/api/restaurants/:id/status', async (req,res)=>{ const d=await getData(); const r=d.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({}); r.status=req.body.status; if(r.status==='نشطة'){ r.price=r.originalPrice; r.mrr=r.originalPrice; r.isTrial=false; } if(r.status.includes('تجربة')){ r.price=0; r.mrr=0; r.isTrial=true; } if(r.status==='موقوفة'||r.status.includes('منتهي')) r.mrr=0; await saveData(d); res.json(r); });
app.post('/api/restaurants/:id/activate', async (req,res)=>{ const d=await getData(); const r=d.restaurants.find(x=>x.id===req.params.id); if(!r) return res.status(404).json({}); r.status='نشطة'; r.price=r.originalPrice; r.mrr=r.originalPrice; r.isTrial=false; r.freeMonth=false; r.expiry=new Date(Date.now()+30*86400000).toISOString().split('T')[0]; r.remainingDays=30; await saveData(d); res.json(r); });

// Auth - Restaurant Owner
app.post('/api/auth/owner/login', async (req,res)=>{
  const d=await getData();
  const {phone, password}=req.body;
  const r=d.restaurants.find(x=>x.phone===phone && x.password===password);
  if(!r) return res.status(401).json({error:'رقم أو باسورد غلط'});
  if(r.status==='موقوفة') return res.status(403).json({error:'حسابك موقوف - تواصل مع الإدارة'});
  if(r.remainingDays===0) return res.status(403).json({error:'اشتراكك منتهي'});
  res.json({ok:true, restaurant:r});
});

// Menus
app.get('/api/restaurants/:id/menu', async (req,res)=>{ const d=await getData(); res.json((d.menus&&d.menus[req.params.id])||[]); });
app.post('/api/restaurants/:id/menu', async (req,res)=>{ const d=await getData(); if(!d.menus) d.menus={}; if(!d.menus[req.params.id]) d.menus[req.params.id]=[]; const item={id:'item_'+Date.now(), ...req.body, available:true}; d.menus[req.params.id].push(item); await saveData(d); res.json(item); });
app.put('/api/restaurants/:id/menu/:itemId', async (req,res)=>{ const d=await getData(); const menu=d.menus[req.params.id]||[]; const i=menu.findIndex(x=>x.id===req.params.itemId); if(i===-1) return res.status(404).json({}); menu[i]={...menu[i], ...req.body}; await saveData(d); res.json(menu[i]); });
app.delete('/api/restaurants/:id/menu/:itemId', async (req,res)=>{ const d=await getData(); if(d.menus&&d.menus[req.params.id]) d.menus[req.params.id]=d.menus[req.params.id].filter(x=>x.id!==req.params.itemId); await saveData(d); res.json({ok:true}); });

// Orders
app.get('/api/orders', async (req,res)=>{ const d=await getData(); let orders=d.orders||[]; if(req.query.restaurant) orders=orders.filter(o=>o.restaurantId===req.query.restaurant); res.json(orders.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))); });
app.post('/api/orders', async (req,res)=>{ const d=await getData(); const order={id:'ord_'+Date.now(), ...req.body, createdAt:new Date().toISOString(), status:'جديد'}; d.orders=d.orders||[]; d.orders.push(order); await saveData(d); res.json(order); });
app.put('/api/orders/:id', async (req,res)=>{ const d=await getData(); const i=d.orders.findIndex(o=>o.id===req.params.id); if(i===-1) return res.status(404).json({}); d.orders[i]={...d.orders[i], ...req.body}; await saveData(d); res.json(d.orders[i]); });

app.get('/api/stats', async (req,res)=>{ const d=await getData(); const r=d.restaurants; const active=r.filter(x=>x.status==='نشطة').length; const trial=r.filter(x=>x.status.includes('تجربة')).length; const stopped=r.filter(x=>x.status==='موقوفة').length; const expired=r.filter(x=>x.status.includes('منتهي')||x.remainingDays===0).length; const mrr=r.filter(x=>x.status==='نشطة').reduce((s,x)=>s+(x.mrr||0),0); res.json({active,trial,stopped,expired,mrr,total:r.length, orders:d.orders.length}); });

// Pages
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/super', (req,res)=> res.sendFile(path.join(__dirname,'public','super.html')));
app.get('/owner', (req,res)=> res.sendFile(path.join(__dirname,'public','owner.html')));
app.get('/qr', (req,res)=> res.sendFile(path.join(__dirname,'public','qr.html')));
app.get('/menu/:id', (req,res)=> res.sendFile(path.join(__dirname,'public','customer.html')));
app.get('/c/:id/:table', (req,res)=> res.sendFile(path.join(__dirname,'public','customer.html')));
app.get('/manage/:id', (req,res)=> res.sendFile(path.join(__dirname,'public','manage-menu.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT, ()=> console.log('3 Platforms running',PORT,kvMode));
