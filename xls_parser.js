// xls_parser.js
const XLSX = require('xlsx');

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
  }
  return productos;
}

module.exports = { parseStockBuffer };
