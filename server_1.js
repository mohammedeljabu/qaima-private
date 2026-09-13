
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// API: Get all restaurants
app.get('/api/restaurants', (req, res) => {
    const data = readData();
    res.json(data);
});

// API: Stats
app.get('/api/stats', (req, res) => {
    const data = readData();
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

    res.json({
        mrr,
        activeCount: active.length,
        trialCount: trial.length,
        expiredCount: expired.length,
        expiringThisWeek,
        total: data.length
    });
});

// API: Add restaurant
app.post('/api/restaurants', (req, res) => {
    const data = readData();
    const newId = data.length > 0 ? Math.max(...data.map(r => r.id)) + 1 : 1;
    const newRestaurant = { id: newId, ...req.body };
    data.push(newRestaurant);
    writeData(data);
    res.json(newRestaurant);
});

// API: Update restaurant
app.put('/api/restaurants/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let data = readData();
    const index = data.findIndex(r => r.id === id);
    if (index === -1) return res.status(404).json({error: 'Not found'});
    data[index] = { ...data[index], ...req.body };
    writeData(data);
    res.json(data[index]);
});

// API: Delete restaurant
app.delete('/api/restaurants/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let data = readData();
    data = data.filter(r => r.id !== id);
    writeData(data);
    res.json({success: true});
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Qaima Private Server يعمل على http://localhost:${PORT}`);
    console.log(`📁 البيانات محفوظة في: ${DATA_FILE}`);
    console.log(`🔒 مشروع خاص - لا دفع تلقائي - تحكم يدوي كامل`);
});
