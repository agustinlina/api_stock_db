// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { connectMongo } = require('./db');
const { parseStockBuffer } = require('./xls_parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
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
    protectores: 'stock_protectores',
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

    const productos = parseStockBuffer(req.file.buffer);
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

// lectura: /api/stock?deposito=olav  (o personalizado con &customName=...)
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

app.get('/', (_req, res) => {
  res.send('API de Stock funcionando. Abrí / para subir XLS y /api/stock?deposito=olav para consultar.');
});

// logs de errores “silenciosos”
process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
