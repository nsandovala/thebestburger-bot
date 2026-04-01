const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'tbb_pedidos.db');
const db = new Database(dbPath);

console.log(`🗄️ Base de datos conectada: ${dbPath}`);

// Inicializar tablas (si no existen)
db.exec(`
    CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_id TEXT NOT NULL,
        combo_id TEXT,
        combo_nombre TEXT,
        precio INTEGER,
        direccion TEXT,
        estado TEXT DEFAULT 'pendiente',
        creado_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS sesiones (
        wa_id TEXT PRIMARY KEY,
        estado TEXT,
        combo_json TEXT,
        direccion TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

module.exports = {
    // Guardar sesión activa
    saveSession: (waId, data) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO sesiones (wa_id, estado, combo_json, direccion)
            VALUES (?, ?, ?, ?)
        `);
        const comboJson = data.combo ? JSON.stringify(data.combo) : null;
        stmt.run(waId, data.estado, comboJson, data.direccion);
    },
    
    // Recuperar sesión
    getSession: (waId) => {
        const row = db.prepare('SELECT * FROM sesiones WHERE wa_id = ?').get(waId);
        if (!row) return null;
        
        return {
            estado: row.estado,
            combo: row.combo_json ? JSON.parse(row.combo_json) : null,
            direccion: row.direccion
        };
    },
    
    // Guardar pedido confirmado
    savePedido: (waId, combo, direccion) => {
        const stmt = db.prepare(`
            INSERT INTO pedidos (wa_id, combo_id, combo_nombre, precio, direccion, 
estado)
            VALUES (?, ?, ?, ?, ?, 'confirmado')
        `);
        const info = stmt.run(waId, combo.id, combo.nombre, combo.precio, direccion);
        return info.lastInsertRowid;
    },
    
// Obtener historial
getHistorial: (waId) => {
    return db.prepare('SELECT * FROM pedidos WHERE wa_id = ? ORDER BY creado_at DESC').all(waId);
},
    
    // Debug: contar pedidos
    countPedidos: () => {
        return db.prepare('SELECT COUNT(*) as total FROM pedidos').get();
    }
};
