// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { connectMongo } = require('./db');
const { parseStockBuffer, parsePricesBuffer } = require('./xls_parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ---------- helpers ----------
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function collectionForDeposito(deposito, customName) {
  const map = {
    olav: 'stock_olav',
    polo: 'stock_polo',
    cba: 'stock_cba',
    llantas: 'stock_llantas',
    camaras: 'stock_camaras',
    protectores: 'stock_protectores',
    prices: 'prices', // <-- CORRECTO: la colección de precios se llama "prices"
  };
  const key = (deposito || '').toLowerCase().trim();
  if (key === 'personalizado') {
    const norm = normalizeName(customName);
    if (!norm) throw new Error('Nombre personalizado inválido');
    return `stock_${norm}`;
  }
  return map[key] || `stock_${normalizeName(key)}`;
}

// ---------- health ----------
app.get('/health/db', async (_req, res) => {
  try {
    const { db } = await connectMongo();
    await db.command({ ping: 1 });
    res.json({ ok: true });
  } catch (e) {
    console.error('DB health error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- upload (sobrescribe colección) ----------
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });

    const deposito = (req.body.deposito || '').trim().toLowerCase();
    const customName = (req.body.customName || '').trim();
    if (!deposito) return res.status(400).json({ ok: false, error: 'Falta el campo "deposito"' });

    const collectionName = collectionForDeposito(deposito, customName);

    // Parser según depósito
    let productos;
    if (deposito === 'prices' || collectionName === 'prices') {
      // Excel prices: Col A = codigo, Col B = precio (USD)
      productos = parsePricesBuffer(req.file.buffer); // -> [{ codigo, precio }]
    } else {
      // Excel stock: A/C/F/H desde fila 10
      productos = parseStockBuffer(req.file.buffer);  // -> [{ codigo, descripcion, rubro, stock }]
    }

    console.log(`[UPLOAD] deposito=${deposito} collection=${collectionName} parsed=${productos.length}`);

    const { db } = await connectMongo();
    const col = db.collection(collectionName);

    // Sobrescribe colección completa
    await col.deleteMany({});
    let inserted = 0;
    if (productos.length) {
      const now = new Date();
      const docs = productos.map(p => ({ ...p, uploadedAt: now }));
      const r = await col.insertMany(docs, { ordered: false });
      inserted = r.insertedCount ?? Object.keys(r.insertedIds || {}).length ?? docs.length;
    }

    res.json({ ok: true, deposito, collection: collectionName, parsed: productos.length, inserted });
  } catch (e) {
    console.error('Error en /upload:', e);
    res.status(500).json({ ok: false, error: 'No se pudo procesar el archivo', detail: String(e) });
  }
});

// ---------- lectura ----------
app.get('/api/stock', async (req, res) => {
  try {
    const deposito = (req.query.deposito || '').trim().toLowerCase();
    const customName = (req.query.customName || '').trim();
    if (!deposito) return res.status(400).json({ ok: false, error: 'Falta ?deposito=' });

    const collectionName = collectionForDeposito(deposito, customName);
    const { db } = await connectMongo();

    // PRECIOS: debe devolver únicamente [{ codigo, precio }]
    if (deposito === 'prices' || collectionName === 'prices') {
      const docs = await db
        .collection('prices')
        .find({}, { projection: { _id: 0, codigo: 1, precio: 1 } })
        .toArray();

      // Normalizamos precio a número si es posible; si no, lo dejamos como está.
      const out = docs.map(d => {
        const codigo = String(d?.codigo ?? '').trim();
        let precio = d?.precio;
        if (typeof precio !== 'number') {
          const s = String(precio ?? '')
            .replace(/\s/g, '')
            .replace(/\./g, '')
            .replace(',', '.');
          const n = Number(s);
          precio = Number.isFinite(n) ? n : (precio ?? null);
        }
        return { codigo, precio };
      });

      return res.json(out);
    }

    // STOCK: envelope con items
    const items = await db
      .collection(collectionName)
      .find({}, { projection: { _id: 0 } })
      .toArray();

    res.json({ ok: true, deposito, collection: collectionName, items });
  } catch (e) {
    console.error('Error en /api/stock:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- editar por codigo ----------
app.put('/api/stock/item', async (req, res) => {
  try {
    const { deposito, customName, originalCodigo, update } = req.body || {};
    if (!deposito)       return res.status(400).json({ ok: false, error: 'Falta deposito' });
    if (!originalCodigo) return res.status(400).json({ ok: false, error: 'Falta originalCodigo' });
    if (!update || typeof update !== 'object') {
      return res.status(400).json({ ok: false, error: 'Falta update' });
    }

    const dep = String(deposito).toLowerCase().trim();
    const collectionName = collectionForDeposito(dep, customName);
    const { db } = await connectMongo();
    const col = db.collection(collectionName);

    const allowed = dep === 'prices'
      ? ['codigo', 'precio']  // precios: solo codigo y precio
      : ['codigo', 'descripcion', 'rubro', 'stock'];

    const set = { uploadedAt: new Date() };
    for (const k of allowed) {
      if (update[k] !== undefined) {
        if (k === 'precio') {
          const s = String(update[k])
            .replace(/\s/g, '')
            .replace(/\./g, '')
            .replace(',', '.');
          const n = Number(s);
          set[k] = Number.isNaN(n) ? String(update[k]).trim() : n;
        } else {
          set[k] = String(update[k]).trim();
        }
      }
    }

    const q = { codigo: String(originalCodigo).trim() };
    const result = await col.updateOne(q, { $set: set });

    if (result.matchedCount === 0) {
      return res.status(404).json({ ok: false, error: 'No existe un item con ese codigo' });
    }

    res.json({ ok: true, updated: result.modifiedCount });
  } catch (e) {
    console.error('Error en PUT /api/stock/item:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- 404 JSON para /api/*
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta API no encontrada', path: req.originalUrl });
});

app.get('/', (_req, res) => {
  res.send('API de Stock funcionando. /upload (POST) para XLS. /api/stock?deposito=prices devuelve [{codigo, precio}].');
});

process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
