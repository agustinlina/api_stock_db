// server.js
const express = require('express');
const cors = require('cors');
const { getStockOlav, getStockCba, getStockPolo} = require('./api/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/api/stock_olav', (req, res) => {
    try {
        const productos = getStockOlav();
        res.json(productos);
    } catch (err) {
        res.status(500).json({ error: 'No se pudo leer stock_olav.xls' });
    }
});

app.get('/api/stock_cba', (req, res) => {
    try {
        const productos = getStockCba();
        res.json(productos);
    } catch (err) {
        res.status(500).json({ error: 'No se pudo leer stock_cba.xls' });
    }
});

app.get('/api/stock_polo', (req, res) => {
    try {
        const productos = getStockPolo();
        res.json(productos);
    } catch (err) {
        res.status(500).json({ error: 'No se pudo leer stock_polo.xls' });
    }
});

app.get('/', (req, res) => {
    res.send('API de Stock funcionando.');
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
