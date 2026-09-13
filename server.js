
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

function readJson(file, fallback) {
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
function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// Init files
readJson(DATA_FILE, []);
readJson(ORDERS_FILE, []);

// --- Restaurants API ---
app.get('/api/restaurants', (req, res) => {
    res.json(readJson(DATA_FILE, []));
});

app.get('/api/stats', (req, res) => {
    const data = readJson(DATA_FILE, []);
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

app.post('/api/restaurants', (req, res) => {
    const data = readJson(DATA_FILE, []);
    const newId = data.length > 0 ? Math.max(...data.map(r => r.id)) + 1 : 1;
    const newR = { id: newId, ...req.body };
    data.push(newR);
    writeJson(DATA_FILE, data);
    res.json(newR);
});

app.put('/api/restaurants/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let data = readJson(DATA_FILE, []);
    const idx = data.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({error: 'Not found'});
    data[idx] = { ...data[idx], ...req.body };
    writeJson(DATA_FILE, data);
    res.json(data[idx]);
});

app.delete('/api/restaurants/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let data = readJson(DATA_FILE, []);
    data = data.filter(r => r.id !== id);
    writeJson(DATA_FILE, data);
    res.json({success: true});
});

// --- Orders API ---
app.get('/api/orders', (req, res) => {
    res.json(readJson(ORDERS_FILE, []));
});

app.post('/api/orders', (req, res) => {
    const orders = readJson(ORDERS_FILE, []);
    const newId = orders.length > 0 ? Math.max(...orders.map(o => o.id)) + 1 : 1;
    const newOrder = { id: newId, createdAt: new Date().toISOString(), status: 'جديد', ...req.body };
    orders.unshift(newOrder);
    writeJson(ORDERS_FILE, orders);
    res.json(newOrder);
});

app.put('/api/orders/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let orders = readJson(ORDERS_FILE, []);
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return res.status(404).json({error: 'Not found'});
    orders[idx] = { ...orders[idx], ...req.body };
    writeJson(ORDERS_FILE, orders);
    res.json(orders[idx]);
});

app.delete('/api/orders/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let orders = readJson(ORDERS_FILE, []);
    orders = orders.filter(o => o.id !== id);
    writeJson(ORDERS_FILE, orders);
    res.json({success: true});
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Qaima Private Server يعمل على المنفذ ${PORT}`);
    console.log(`🔒 بدون دفع تلقائي - تحكم يدوي كامل`);
});
