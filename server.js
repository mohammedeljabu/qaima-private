
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Try to load Vercel KV if configured
let kv = null;
let useKV = false;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = require('@vercel/kv').kv;
    useKV = true;
    console.log('✅ Vercel KV متصل - البيانات ستحفظ للأبد');
  } else {
    console.log('⚠️ KV غير موجود - يستخدم ملفات مؤقتة + local backup');
  }
} catch(e) {
  console.log('KV not available, fallback to file', e.message);
}

function readJsonFile(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf-8');
            return fallback;
        }
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
        return fallback;
    }
}
function writeJsonFile(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    } catch(e) {
        console.error("Write file error", e.message);
    }
}

// Load initial seed data
const seedRestaurants = readJsonFile(DATA_FILE, []);
const seedOrders = readJsonFile(ORDERS_FILE, []);

async function getRestaurants() {
  if (useKV) {
    try {
      let data = await kv.get('qaima:restaurants');
      if (!data) {
        // first time - seed from file
        await kv.set('qaima:restaurants', seedRestaurants);
        return seedRestaurants;
      }
      return data;
    } catch(e) {
      console.error('KV get error', e);
      return seedRestaurants;
    }
  } else {
    return readJsonFile(DATA_FILE, seedRestaurants);
  }
}

async function saveRestaurants(data) {
  if (useKV) {
    try {
      await kv.set('qaima:restaurants', data);
    } catch(e) {
      console.error('KV set error', e);
    }
  }
  // also save to file as backup (ephemeral but good for local)
  writeJsonFile(DATA_FILE, data);
}

async function getOrders() {
  if (useKV) {
    try {
      let data = await kv.get('qaima:orders');
      if (!data) {
        await kv.set('qaima:orders', seedOrders);
        return seedOrders;
      }
      return data;
    } catch(e) {
      return seedOrders;
    }
  } else {
    return readJsonFile(ORDERS_FILE, seedOrders);
  }
}

async function saveOrders(data) {
  if (useKV) {
    try {
      await kv.set('qaima:orders', data);
    } catch(e) {}
  }
  writeJsonFile(ORDERS_FILE, data);
}

// API Routes - all async now

app.get('/api/restaurants', async (req, res) => {
    const data = await getRestaurants();
    res.json(data);
});

app.get('/api/stats', async (req, res) => {
    const data = await getRestaurants();
    const active = data.filter(r => r.status === 'نشط');
    const trial = data.filter(r => r.status === 'تجربة مجانية');
    const expired = data.filter(r => r.status === 'منتهي' || r.status === 'موقوف');
    const mrr = active.reduce((sum, r) => sum + (r.amount || 0), 0);
    const expiringThisWeek = data.filter(r => {
        const end = new Date(r.endDate);
        const now = new Date();
        const diff = (end - now) / (1000*60*60*24);
        return diff >= 0 && diff <= 7;
    }).length;
    res.json({ mrr, activeCount: active.length, trialCount: trial.length, expiredCount: expired.length, expiringThisWeek, total: data.length });
});

app.post('/api/restaurants', async (req, res) => {
    const data = await getRestaurants();
    const newId = data.length > 0 ? Math.max(...data.map(r => r.id)) + 1 : 1;
    const newR = { id: newId, ...req.body };
    data.push(newR);
    await saveRestaurants(data);
    res.json(newR);
});

app.put('/api/restaurants/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    let data = await getRestaurants();
    const idx = data.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({error: 'Not found'});
    data[idx] = { ...data[idx], ...req.body };
    await saveRestaurants(data);
    res.json(data[idx]);
});

app.delete('/api/restaurants/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    let data = await getRestaurants();
    data = data.filter(r => r.id !== id);
    await saveRestaurants(data);
    res.json({success: true});
});

app.get('/api/orders', async (req, res) => {
    const orders = await getOrders();
    res.json(orders);
});

app.post('/api/orders', async (req, res) => {
    const orders = await getOrders();
    const newId = orders.length > 0 ? Math.max(...orders.map(o => o.id)) + 1 : 1;
    const newOrder = { id: newId, createdAt: new Date().toISOString(), status: 'جديد', ...req.body };
    orders.unshift(newOrder);
    await saveOrders(orders);
    res.json(newOrder);
});

app.put('/api/orders/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    let orders = await getOrders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return res.status(404).json({error: 'Not found'});
    orders[idx] = { ...orders[idx], ...req.body };
    await saveOrders(orders);
    res.json(orders[idx]);
});

app.delete('/api/orders/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    let orders = await getOrders();
    orders = orders.filter(o => o.id !== id);
    await saveOrders(orders);
    res.json({success: true});
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Qaima يعمل على المنفذ ${PORT} - ${useKV ? 'KV دائم' : 'ملفات مؤقتة'}`);
    });
}

module.exports = app;
