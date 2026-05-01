const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'tbb_pedidos.db');
const db = new Database(dbPath);

console.log(`🗄️ Base de datos conectada: ${dbPath}`);

// Migración para BD existente (agregar columnas nuevas si no existen)
// Nota: SQLite no soporta "ADD COLUMN IF NOT EXISTS", capturamos el error
const columnasNuevas = [
    'ALTER TABLE pedidos ADD COLUMN direccion_validated BOOLEAN DEFAULT 0',
    'ALTER TABLE pedidos ADD COLUMN payment_method TEXT',
    'ALTER TABLE pedidos ADD COLUMN payment_method_id TEXT',
    'ALTER TABLE pedidos ADD COLUMN sync_status TEXT DEFAULT \'pending\'',
    'ALTER TABLE pedidos ADD COLUMN sync_retries INTEGER DEFAULT 0',
    'ALTER TABLE pedidos ADD COLUMN firestore_id TEXT',
    'ALTER TABLE pedidos ADD COLUMN synced_at DATETIME',
    'ALTER TABLE pedidos ADD COLUMN sync_error TEXT',
    'ALTER TABLE pedidos ADD COLUMN tipo_entrega TEXT',
    'ALTER TABLE sesiones ADD COLUMN direccion_validated BOOLEAN DEFAULT 0',
    'ALTER TABLE sesiones ADD COLUMN payment_method TEXT',
    'ALTER TABLE sesiones ADD COLUMN payment_method_id TEXT',
    'ALTER TABLE sesiones ADD COLUMN tipo_entrega TEXT'
];

columnasNuevas.forEach(sql => {
    try {
        db.exec(sql);
    } catch (e) {
        // Ignorar error si la columna ya existe (SQLITE_ERROR: duplicate column name)
        if (!e.message.includes('duplicate column')) {
            throw e;
        }
    }
});

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pedidos_sync_status ON pedidos(sync_status);
    CREATE INDEX IF NOT EXISTS idx_pedidos_creado_at ON pedidos(creado_at);
`);

// Inicializar tablas (si no existen)
db.exec(`
    CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_id TEXT NOT NULL,
        combo_id TEXT,
        combo_nombre TEXT,
        precio INTEGER,
        direccion TEXT,
        direccion_validated BOOLEAN DEFAULT 0,
        payment_method TEXT,
        payment_method_id TEXT,
        tipo_entrega TEXT,
        sync_status TEXT DEFAULT 'pending',
        sync_retries INTEGER DEFAULT 0,
        firestore_id TEXT,
        synced_at DATETIME,
        sync_error TEXT,
        estado TEXT DEFAULT 'pendiente',
        creado_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sesiones (
        wa_id TEXT PRIMARY KEY,
        estado TEXT,
        combo_json TEXT,
        direccion TEXT,
        direccion_validated BOOLEAN DEFAULT 0,
        payment_method TEXT,
        payment_method_id TEXT,
        tipo_entrega TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

console.log('🗄️ Schema v2 listo (con sync y payment fields)');

module.exports = {
    // Guardar sesión activa
    saveSession: (waId, data) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO sesiones 
            (wa_id, estado, combo_json, direccion, direccion_validated, payment_method, payment_method_id, tipo_entrega)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const comboJson = data.combo ? JSON.stringify(data.combo) : null;
        stmt.run(
            waId, 
            data.estado, 
            comboJson, 
            data.direccion, 
            data.direccion_validated ? 1 : 0,
            data.payment_method,
            data.payment_method_id,
            data.tipo_entrega ?? null
        );
    },

    // Recuperar sesión
    getSession: (waId) => {
        const row = db.prepare('SELECT * FROM sesiones WHERE wa_id = ?').get(waId);
        if (!row) return null;

        return {
            estado: row.estado,
            combo: row.combo_json ? JSON.parse(row.combo_json) : null,
            direccion: row.direccion,
            direccion_validated: row.direccion_validated === 1,
            payment_method: row.payment_method,
            payment_method_id: row.payment_method_id,
            tipo_entrega: row.tipo_entrega
        };
    },

    // Guardar pedido confirmado
    savePedido: (waId, combo, direccion, tipoEntrega, paymentMethod, paymentMethodId) => {
        const stmt = db.prepare(`
            INSERT INTO pedidos 
            (wa_id, combo_id, combo_nombre, precio, direccion, direccion_validated, 
             payment_method, payment_method_id, tipo_entrega, sync_status, estado)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pending', 'confirmado')
        `);
        const info = stmt.run(
            waId, 
            combo.id, 
            combo.nombre, 
            combo.precio, 
            direccion,
            paymentMethod,
            paymentMethodId,
            tipoEntrega ?? null
        );
        return info.lastInsertRowid;
    },

    // Obtener historial
    getHistorial: (waId) => {
        return db.prepare('SELECT * FROM pedidos WHERE wa_id = ? ORDER BY creado_at DESC').all(waId);
    },
    
    // Obtener pedidos pendientes de sync
    getPendingSync: (limit = 5) => {
        return db.prepare(`
            SELECT * FROM pedidos 
            WHERE sync_status = 'pending' 
               OR (sync_status = 'error' AND sync_retries < 3)
            ORDER BY creado_at ASC 
            LIMIT ?
        `).all(limit);
    },
    
    // Marcar como sync exitoso
    markAsSynced: (sqliteId, firestoreId) => {
        const stmt = db.prepare(`
            UPDATE pedidos 
            SET sync_status = 'synced', 
                firestore_id = ?, 
                synced_at = CURRENT_TIMESTAMP,
                sync_retries = 0,
                sync_error = NULL
            WHERE id = ?
        `);
        stmt.run(firestoreId, sqliteId);
    },
    
    // Marcar como error
    markAsError: (sqliteId, errorMsg) => {
        const stmt = db.prepare(`
            UPDATE pedidos 
            SET sync_status = 'error', 
                sync_error = ?,
                sync_retries = sync_retries + 1
            WHERE id = ?
        `);
        stmt.run(errorMsg, sqliteId);
    },
    
    // Helper para obtener pedido por ID
    getPedidoById: (id) => {
        return db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
    },
    
    // Debug: contar pedidos
    countPedidos: () => {
        return db.prepare('SELECT COUNT(*) as total FROM pedidos').get();
    }
};
