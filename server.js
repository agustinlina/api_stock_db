// server.js
const express = require('express')
const cors = require('cors')
const multer = require('multer')
const path = require('path')
const { connectMongo } = require('./db')
const { parseStockBuffer, parsePricesBuffer } = require('./xls_parser')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json()) // para PUT/POST JSON
app.use(express.static(path.join(__dirname, 'public')))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
})

// ----- helpers -----
function normalizeName (s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

function collectionForDeposito (deposito, customName) {
  const map = {
    olav: 'stock_olav',
    polo: 'stock_polo',
    cba: 'stock_cba',
    llantas: 'stock_llantas',
    camaras: 'stock_camaras',
    protectores: 'stock_protectores',
    prices: 'prices' // colección de precios
  }
  const key = (deposito || '').toLowerCase().trim()
  if (key === 'personalizado') {
    const norm = normalizeName(customName)
    if (!norm) throw new Error('Nombre personalizado inválido')
    return `stock_${norm}`
  }
  return map[key] || `stock_${normalizeName(key)}`
}

// ----- health -----
app.get('/health/db', async (_req, res) => {
  try {
    const { db } = await connectMongo()
    await db.command({ ping: 1 })
    res.json({ ok: true })
  } catch (e) {
    console.error('DB health error:', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// ----- upload: sobrescribe colección -----
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ ok: false, error: 'Falta el archivo' })
    const deposito = (req.body.deposito || '').trim().toLowerCase()
    const customName = (req.body.customName || '').trim()
    if (!deposito)
      return res
        .status(400)
        .json({ ok: false, error: 'Falta el campo "deposito"' })

    const collectionName = collectionForDeposito(deposito, customName)

    // Parser según colección
    let productos
    if (collectionName === 'prices' || deposito === 'prices') {
      // [{codigo, precio}] desde columnas A/B
      productos = parsePricesBuffer(req.file.buffer)
    } else {
      // [{codigo, descripcion, rubro, stock}] desde A/C/F/H
      productos = parseStockBuffer(req.file.buffer)
    }

    console.log(
      `[UPLOAD] deposito=${deposito} collection=${collectionName} parsed=${productos.length}`
    )

    const { db } = await connectMongo()
    const col = db.collection(collectionName)

    await col.deleteMany({})
    let inserted = 0
    if (productos.length) {
      const now = new Date()
      const docs = productos.map(p => ({ ...p, uploadedAt: now }))
      const r = await col.insertMany(docs, { ordered: false })
      inserted =
        r.insertedCount ??
        Object.keys(r.insertedIds || {}).length ??
        docs.length
    }

    res.json({
      ok: true,
      deposito,
      collection: collectionName,
      parsed: productos.length,
      inserted
    })
  } catch (e) {
    console.error('Error en /upload:', e)
    res
      .status(500)
      .json({
        ok: false,
        error: 'No se pudo procesar el archivo',
        detail: String(e)
      })
  }
})

// ----- lectura: /api/stock -----
app.get('/api/stock', async (req, res) => {
  try {
    const deposito = (req.query.deposito || '').trim().toLowerCase()
    const customName = (req.query.customName || '').trim()
    if (!deposito)
      return res.status(400).json({ ok: false, error: 'Falta ?deposito=' })

    const collectionName = collectionForDeposito(deposito, customName)
    const { db } = await connectMongo()

    if (collectionName === 'prices' || deposito === 'prices') {
      // >>> Requisito: devolver UNICAMENTE { code, price } (array plano)
      const docs = await db
        .collection('prices')
        .find({}, { projection: { _id: 0, codigo: 1, precio: 1 } })
        .toArray()

      // normalización y renombre de campos
      const out = docs.map(d => {
        const code = String(d?.codigo ?? '').trim()
        // convertir "precio" a número si es posible
        let price = d?.precio
        if (typeof price !== 'number') {
          const s = String(price ?? '')
            .replace(/\s/g, '')
            .replace(/\./g, '')
            .replace(',', '.')
          const n = Number(s)
          price = Number.isFinite(n) ? n : null
        }
        return { code, price }
      })

      return res.json(out) // <-- SOLO [{code, price}]
    }

    // Para stock: envelope clásico con items
    const items = await db
      .collection(collectionName)
      .find({}, { projection: { _id: 0 } })
      .toArray()

    res.json({ ok: true, deposito, collection: collectionName, items })
  } catch (e) {
    console.error('Error en /api/stock:', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// ----- editar item por codigo -----
app.put('/api/stock/item', async (req, res) => {
  try {
    const { deposito, customName, originalCodigo, update } = req.body || {}
    if (!deposito)
      return res.status(400).json({ ok: false, error: 'Falta deposito' })
    if (!originalCodigo)
      return res.status(400).json({ ok: false, error: 'Falta originalCodigo' })
    if (!update || typeof update !== 'object')
      return res.status(400).json({ ok: false, error: 'Falta update' })

    const dep = String(deposito).toLowerCase().trim()
    const collectionName = collectionForDeposito(dep, customName)
    const { db } = await connectMongo()
    const col = db.collection(collectionName)

    const allowed =
      dep === 'prices'
        ? ['codigo', 'precio'] // precios: solo codigo, precio
        : ['codigo', 'descripcion', 'rubro', 'stock']

    const set = { uploadedAt: new Date() }
    for (const k of allowed) {
      if (update[k] !== undefined) {
        if (k === 'precio') {
          const s = String(update[k])
            .replace(/\s/g, '')
            .replace(/\./g, '')
            .replace(',', '.')
          const n = Number(s)
          set[k] = Number.isNaN(n) ? String(update[k]).trim() : n
        } else {
          set[k] = String(update[k]).trim()
        }
      }
    }

    const q = { codigo: String(originalCodigo).trim() }
    const result = await col.updateOne(q, { $set: set })

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ ok: false, error: 'No existe un item con ese codigo' })
    }

    res.json({ ok: true, updated: result.modifiedCount })
  } catch (e) {
    console.error('Error en PUT /api/stock/item:', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// ----- 404 JSON para /api/*
app.use('/api', (req, res) => {
  res
    .status(404)
    .json({ ok: false, error: 'Ruta API no encontrada', path: req.originalUrl })
})

app.get('/', (_req, res) => {
  res.send(
    'API de Stock funcionando. /upload (POST) para XLS, /api/stock?deposito=prices devuelve [{code, price}].'
  )
})

// logs
process.on('unhandledRejection', r => console.error('UNHANDLED REJECTION:', r))
process.on('uncaughtException', e => console.error('UNCAUGHT EXCEPTION:', e))

app.listen(PORT, () =>
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
)
