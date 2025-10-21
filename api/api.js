// api/api.js
const path = require('path');
const XLSX = require('xlsx');

function leerStockExcel(nombreArchivo) {
    const ruta = path.join(__dirname, nombreArchivo);  // Buscamos dentro de api/
    const workbook = XLSX.readFile(ruta);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    let fila = 10;
    let productos = [];
    while (true) {
        const codigo = sheet['A' + fila] ? String(sheet['A' + fila].v).trim() : '';
        const descripcion = sheet['C' + fila] ? String(sheet['C' + fila].v).trim() : '';
        const rubro = sheet['F' + fila] ? String(sheet['F' + fila].v).trim() : '';
        const stock = sheet['H' + fila] ? String(sheet['H' + fila].v).trim() : '';

        // Si no hay código ni descripción, terminamos el ciclo
        if (!codigo && !descripcion) break;

        productos.push({ codigo, descripcion, rubro, stock });
        fila++;
    }
    return productos;
}

function getStockOlav() {
    return leerStockExcel('olav.xls');
}

function getStockCba() {
    return leerStockExcel('cba.xls');
}

function getStockPolo() {
    return leerStockExcel('polo.xls');
}

module.exports = {
    getStockOlav,
    getStockCba,
    getStockPolo
};
