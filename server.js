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
app.use(express.json()); // << NECESARIO para PUT/POST con JSON
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// normalizador para nombres personalizados
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

// mapeo depósito -> colección
function collectionForDeposito(deposito, customName) {
  const map = {
    olav: 'stock_olav',
    polo: 'stock_polo',
    cba: 'stock_cba',
    llantas: 'stock_llantas',
    camaras: 'stock_camaras',
    protectores: 'stock_protectores', // respetando tu estructura actual
    prices: 'prices',                 // NUEVO: colección de precios
  };
  const key = (deposito || '').toLowerCase().trim();
  if (key === 'personalizado') {
    const norm = normalizeName(customName);
    if (!norm) throw new Error('Nombre personalizado inválido');
    return `stock_${norm}`;
    }
  return map[key] || `stock_${normalizeName(key)}`;
}

// salud DB
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

// upload: SOBRESCRIBE colección del depósito
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const deposito = (req.body.deposito || '').trim().toLowerCase();
    const customName = (req.body.customName || '').trim();
    if (!deposito) return res.status(400).json({ ok: false, error: 'Falta el campo "deposito"' });

    const collectionName = collectionForDeposito(deposito, customName);

    // Parser según colección
    let productos;
    if (collectionName === 'prices' || deposito === 'prices') {
      productos = parsePricesBuffer(req.file.buffer);        // [{codigo, precio}]
    } else {
      productos = parseStockBuffer(req.file.buffer);         // [{codigo, descripcion, rubro, stock}]
    }

    console.log(`[UPLOAD] deposito=${deposito} collection=${collectionName} parsed=${productos.length}`);

    const { db } = await connectMongo();
    const col = db.collection(collectionName);

    // sobrescritura: borro TODO y vuelvo a insertar
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

// lectura: /api/stock?deposito=olav | cba | prices | ...
app.get('/api/stock', async (req, res) => {
  try {
    const deposito = (req.query.deposito || '').trim().toLowerCase();
    const customName = (req.query.customName || '').trim();
    if (!deposito) return res.status(400).json({ ok: false, error: 'Falta ?deposito=' });

    const collectionName = collectionForDeposito(deposito, customName);
    const { db } = await connectMongo();

    const items = await db.collection(collectionName).find({}, { projection: { _id: 0 } }).toArray();
    res.json({ ok: true, deposito, collection: collectionName, items });
  } catch (e) {
    console.error('Error en /api/stock:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// editar un producto por 'codigo'
// Body:
// {
//   deposito: 'olav' | ... | 'prices',
//   customName?: '...',
//   originalCodigo: 'ABC123',
//   update: { codigo?, descripcion?, rubro?, stock?, precio? }  // 'precio' válido cuando deposito === 'prices'
// }
app.put('/api/stock/item', async (req, res) => {
  try {
    const { deposito, customName, originalCodigo, update } = req.body || {};
    if (!deposito)       return res.status(400).json({ ok: false, error: 'Falta deposito' });
    if (!originalCodigo) return res.status(400).json({ ok: false, error: 'Falta originalCodigo' });
    if (!update || typeof update !== 'object') return res.status(400).json({ ok: false, error: 'Falta update' });

    const dep = String(deposito).toLowerCase().trim();
    const collectionName = collectionForDeposito(dep, customName);
    const { db } = await connectMongo();
    const col = db.collection(collectionName);

    // Campos permitidos según depósito
    const allowed = dep === 'prices'
      ? ['codigo', 'precio']                              // precios: solo codigo y precio
      : ['codigo', 'descripcion', 'rubro', 'stock'];      // stock: campos de stock

    const set = { uploadedAt: new Date() };
    for (const k of allowed) {
      if (update[k] !== undefined) {
        // Para 'precio' intentamos guardar número si es convertible
        if (k === 'precio') {
          const n = Number(String(update[k]).replace(/\s/g, '').replace(',', '.'));
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

// catch-all JSON para /api/*
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta API no encontrada', path: req.originalUrl });
});

app.get('/', (_req, res) => {
  res.send('API de Stock funcionando. Abrí / para subir XLS y /products.html para consultar/editar.');
});

// logs
process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
