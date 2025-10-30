// xls_parser.js
const XLSX = require('xlsx');

// ======== PARSER STOCK (sin cambios) ========
function parseStockBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];

  let fila = 10; // ajustá si tu hoja empieza antes
  const productos = [];
  while (true) {
    const codigo = sheet['A' + fila] ? String(sheet['A' + fila].v).trim() : '';
    const descripcion = sheet['C' + fila] ? String(sheet['C' + fila].v).trim() : '';
    const rubro = sheet['F' + fila] ? String(sheet['F' + fila].v).trim() : '';
    const stock = sheet['H' + fila] ? String(sheet['H' + fila].v).trim() : '';
    if (!codigo && !descripcion && !rubro && !stock) break;
    productos.push({ codigo, descripcion, rubro, stock });
    fila++;
    if (fila > 100000) break; // safety
  }
  return productos;
}

// ======== PARSER PRICES (nuevo, basado en tu otro programa) ========

// Parseo robusto: respeta miles y decimales locales
function parsePrecioCell(cell) {
  const val = cell ? (cell.v ?? cell.w ?? '') : '';
  if (typeof val === 'number') return val;

  let s = String(val).trim();
  if (!s) return null;

  // quitar símbolos y espacios
  s = s.replace(/\s/g, '').replace(/[^0-9.,\-]/g, '');

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  if (hasDot && hasComma) {
    // 1.234.567,89 -> 1234567.89
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasDot && !hasComma) {
    // 102.800 -> 102800 (punto como miles)
    s = s.replace(/\./g, '');
  } else if (!hasDot && hasComma) {
    // 102,80 -> 102.80
    s = s.replace(',', '.');
  }

  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Lee un buffer XLS/XLSX con:
 * - Col A: códigos
 * - Col B: precios (misma fila) o en la fila siguiente (offset +1)
 * Detecta offset automáticamente.
 * Devuelve: [{ codigo, precio }]
 */
function parsePricesBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];

  let fila = 1;         // arranca en A1
  let offset = null;    // se detecta la primera vez
  const productos = [];
  let vaciasSeguidas = 0;

  while (true) {
    const cA = sheet['A' + fila];
    const codigo = cA ? String(cA.v ?? cA.w ?? '').trim() : '';

    // Detectar offset una sola vez cuando encontremos la primera fila útil
    let precio = null;
    if (offset === null) {
      const pSame = parsePrecioCell(sheet['B' + fila]);
      const pNext = parsePrecioCell(sheet['B' + (fila + 1)]);
      if (pSame !== null) {
        offset = 0;            // formato A2/B2 (misma fila)
        precio = pSame;
      } else if (pNext !== null) {
        offset = 1;            // formato A1/B2 (desfasado +1)
        precio = pNext;
      } else {
        // todavía no sabemos; seguimos avanzando
      }
    } else {
      // Ya sabemos el offset: tomar B[fila + offset]
      precio = parsePrecioCell(sheet['B' + (fila + offset)]);
    }

    // Criterio de corte (varias filas vacías seguidas)
    if (!codigo && precio === null) {
      vaciasSeguidas++;
      if (vaciasSeguidas >= 5) break;
    } else {
      vaciasSeguidas = 0;
    }

    // Guardar fila válida si hay código o precio
    if (codigo || precio !== null) {
      productos.push({ codigo, precio });
    }

    fila++;
    if (fila > 100000) break; // safety
  }

  return productos;
}

module.exports = { parseStockBuffer, parsePricesBuffer };
