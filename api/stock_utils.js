const path = require('path');
const XLSX = require('xlsx');

function leerStockExcel(nombreArchivo) {
    const ruta = path.join(__dirname, 'files', nombreArchivo); // Cambiado aquí
    const workbook = XLSX.readFile(ruta);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    let fila = 10;
    let productos = [];
    while (true) {
        const codigo = sheet['A' + fila] ? String(sheet['A' + fila].v).trim() : '';
        const descripcion = sheet['C' + fila] ? String(sheet['C' + fila].v).trim() : '';
        const rubro = sheet['F' + fila] ? String(sheet['F' + fila].v).trim() : '';
        const stock = sheet['H' + fila] ? String(sheet['H' + fila].v).trim() : '';

        if (!codigo && !descripcion) break;
        productos.push({ codigo, descripcion, rubro, stock });
        fila++;
    }
    return productos;
}

module.exports = { leerStockExcel };
