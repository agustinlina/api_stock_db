// xls_parser.js
const XLSX = require('xlsx')

/** Normaliza números con miles y decimales locales a Number */
function parsePrecioCell(cell) {
  const val = cell ? (cell.v ?? cell.w ?? '') : ''
  if (typeof val === 'number') return val

  let s = String(val).trim()
  if (!s) return null

  // quitar espacios y símbolos no numéricos (excepto . , -)
  s = s.replace(/\s/g, '').replace(/[^0-9.,\-]/g, '')

  const hasDot = s.includes('.')
  const hasComma = s.includes(',')

  if (hasDot && hasComma) {
    // 1.234.567,89 -> 1234567.89
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (hasDot && !hasComma) {
    // 102.800 -> 102800 (punto como miles)
    // O 123.45 -> 12345 si realmente era decimal con punto; si tu archivo usa coma para decimales, esto está ok.
    // Preferimos tratar el punto como miles en este escenario.
    const parts = s.split('.')
    if (parts.length > 2) {
      // muchos puntos => todos miles
      s = s.replace(/\./g, '')
    } else {
      // un solo punto: si hay 3 dígitos a la izquierda y 3 a la derecha es miles; si 2 a la derecha podría ser decimal.
      // Para evitar falsos, optamos por remover puntos (miles).
      s = s.replace(/\./g, '')
    }
  } else if (!hasDot && hasComma) {
    // 102,80 -> 102.80
    s = s.replace(',', '.')
  }

  const n = Number(s)
  return Number.isNaN(n) ? null : n
}

/** STOCK: lee hoja 1, desde fila 10, columnas A/C/F/H -> {codigo, descripcion, rubro, stock} */
function parseStockBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]

  let fila = 10
  const productos = []
  while (true) {
    const codigo = sheet['A' + fila] ? String(sheet['A' + fila].v).trim() : ''
    const descripcion = sheet['C' + fila] ? String(sheet['C' + fila].v).trim() : ''
    const rubro = sheet['F' + fila] ? String(sheet['F' + fila].v).trim() : ''
    const stockRaw = sheet['H' + fila] ? String(sheet['H' + fila].v).trim() : ''

    // fin cuando toda la fila está vacía
    if (!codigo && !descripcion && !rubro && !stockRaw) break

    productos.push({ codigo, descripcion, rubro, stock: stockRaw })
    fila++
    if (fila > 200000) break // guarda contra loops
  }
  return productos
}

/** PRICES: Col A = codigo, Col B = precio USD. Lee desde fila 1 hacia abajo */
function parsePricesBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]

  let fila = 1
  const precios = []
  let vaciasSeguidas = 0

  while (true) {
    const cA = sheet['A' + fila]
    const cB = sheet['B' + fila]

    const codigo = cA ? String(cA.v ?? cA.w ?? '').trim() : ''
    const precio = parsePrecioCell(cB)

    // criterio de corte: varias filas totalmente vacías seguidas
    if (!codigo && (precio === null || precio === undefined)) {
      vaciasSeguidas++
      if (vaciasSeguidas >= 5) break
    } else {
      vaciasSeguidas = 0
      // guardamos si hay al menos código o precio
      if (codigo || (precio !== null && precio !== undefined)) {
        precios.push({ codigo, precio })
      }
    }

    fila++
    if (fila > 200000) break
  }

  return precios
}

module.exports = { parseStockBuffer, parsePricesBuffer }
