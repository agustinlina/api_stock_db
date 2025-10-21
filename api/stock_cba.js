const { leerStockExcel } = require('./stock_utils');

export default function handler(req, res) {
    try {
        const productos = leerStockExcel('cba.xls');
        res.status(200).json(productos);
    } catch (error) {
        res.status(500).json({ error: 'No se pudo leer cba.xls .' });
    }
}
