const config = require('./config');
const db = require('./database');

class TioBurgerBrain {
    constructor() {
        this.combos = {
            1: { id: "M1", nombre: "Combo Mechada Clásica", desc: "Mechada + papas + bebida", precio: 7600, tiempo: "15-20 min", emoji: "🥩", keywords: ['mechada', '1', 
'clasica'] },
            2: { id: "C1", nombre: "Combo Cheese Burger", desc: "Cheese Burger + papas + bebida", precio: 6950, tiempo: "12-15 min", emoji: "🍔", keywords: ['cheese', '2', 
'queso'] },
            3: { id: "D1", nombre: "Dúo Cheddaron", desc: "2 Mechada Cheddaron + papas", precio: 11500, tiempo: "18-22 min", emoji: "🧀🔥", keywords: ['cheddaron', '3', 'duo cheddar'] },
            4: { id: "D2", nombre: "Dúo Mechada Z", desc: "2 Mechada Z (para hambres épicas)", precio: 11000, tiempo: "18-22 min", emoji: "⚡⚡", keywords: ['mechada z', 
'4', 'duo z', 'zeta'] }
        };
        console.log('🧠 Brain cargado');
    }

    async procesarMensaje(texto, userId) {
        const msg = texto.toLowerCase().trim();
        
        // KILL SWITCH - Siempre funciona
        if (msg === 'reset' || msg === 'reiniciar' || msg === 'emergencia') {
            this.limpiarSesion(userId);
            return {
                tipo: "RESET",
                mensaje: "🔄 *Sistema reiniciado.* Escribe *HOLA* para empezar.",
                nuevoEstado: "INICIO"
            };
        }

        try {
            // Recuperar sesión
            let sesion = db.getSession(userId);
            
if (!sesion) {
    sesion = { estado: "INICIO", combo: null, direccion: null };
} else {
    // Normalizar combo
    if (typeof sesion.combo === 'string') {
        try {
            sesion.combo = JSON.parse(sesion.combo);
        } catch (e) {
            sesion.combo = null;
        }
    }

    sesion.direccion = sesion.direccion ?? null;
}

            // Detectar escalación
            if (this.debeEscalar(msg)) {
                this.limpiarSesion(userId);
                return {
                    tipo: "ESCALAR",
                    mensaje: `🚨 *MODO HUMANO ACTIVADO*\n\nDetecté que necesitas hablar 
con carne y hueso real. Tío Burger fue notificado y te responde en breve.\n\n_Si es 
urgente, llama directo._`,
                    accion: "alertar_nelson",
                    data: { razon: this.detectarRazonEscalacion(msg) }
                };
            }

            // Máquina de estados
            let resultado;
            
            // Si está en medio de flujo pero escribe comando nuevo, reiniciar
            if (sesion.estado !== "INICIO" && 
(['1','2','3','4','hola','menu'].includes(msg))) {
                this.limpiarSesion(userId);
                sesion = { estado: "INICIO", combo: null, direccion: null };
            }

            switch(sesion.estado) {
                case "INICIO":
                    resultado = this.handleInicio(msg, userId);
                    break;
                case "ESPERANDO_COMBO":
                    resultado = this.handleSeleccionCombo(msg, userId);
                    break;
                case "ESPERANDO_DIRECCION":
                    resultado = this.handleDireccion(msg, sesion, userId);
                    break;
                case "ESPERANDO_CONFIRMACION":
                    resultado = this.handleConfirmacion(msg, sesion, userId);
                    break;
                default:
                    resultado = this.resetearSesion(userId);
            }

            // Guardar estado
            if (resultado && resultado.nuevoEstado) {
                db.saveSession(userId, {
    estado: resultado.nuevoEstado,
    combo: resultado.comboData ?? sesion.combo ?? null,
    direccion: resultado.direccionData ?? sesion.direccion ?? null
});
            }

            return resultado;

        } catch (error) {
            console.error('Error:', error);
            return {
                tipo: "ERROR",
                mensaje: "⚠️ *Error de sistema.* Escribe *RESET* para limpiar.",
                nuevoEstado: "INICIO"
            };
        }
    }

    handleInicio(msg, userId) {
        const historial = db.getHistorial(userId);
        const esFrecuente = historial && historial.length > 0;
        
        if (msg.includes('hola') || msg.includes('menu') || msg.includes('precio') || 
msg === 'buenas') {
            let intro = esFrecuente 
                ? `👋 *¿Otra vez tú?* Bueno, al menos tienes buen gusto. 🍔\n\n`
                : `🚨 *HAMBRE DETECTADA...*\nNo pienses tanto, no es una ecuación 
diferencial. Tengo combos listos 😎\n\n`;
            
            return {
                tipo: "MENU",
                mensaje: intro + this.generarMenu() + `\n\n*Escribe el número 
(1-4)*\n_Mientras piensas… otro ya está comiendo_ 🍟`,
                nuevoEstado: "ESPERANDO_COMBO"
            };
        }
        
        // Si escribe número directo
        if (['1','2','3','4'].includes(msg)) {
            return this.handleSeleccionCombo(msg, userId);
        }

        return {
            tipo: "CONFUSION",
            mensaje: `🤖 ¿Qué? No te entendí. Escribe *HOLA* para ver combos o *HABLAR 
CON TÍO BURGER* para humano.`,
            nuevoEstado: "INICIO"
        };
    }

    handleSeleccionCombo(msg, userId) {
        const combo = this.detectarCombo(msg);
        
        if (!combo) {
            return {
                tipo: "ERROR",
                mensaje: `❌ Escribe el *número* (1-4). No me hagas adivinar.`,
                nuevoEstado: "ESPERANDO_COMBO"
            };
        }

        return {
            tipo: "PEDIR_DIRECCION",
            mensaje: `✅ *${combo.nombre}* seleccionado\n💰 
$${this.formatPrecio(combo.precio)}\n⏱️ ${combo.tiempo}\n\n📍 *¿Dónde te la mando?* 
(dirección completa)`,
            nuevoEstado: "ESPERANDO_DIRECCION",
            comboData: combo
        };
    }

    handleDireccion(msg, sesion, userId) {
        if (!msg || msg.length < 5) {
            return {
                tipo: "ERROR",
                mensaje: `🤨 Dirección muy corta. Ejemplo: *Pasaje 9 344, Playa Ancha*`,
                nuevoEstado: "ESPERANDO_DIRECCION"
            };
        }

        const combo = sesion.combo;
        if (!combo) {
            this.limpiarSesion(userId);
            return {
                tipo: "ERROR",
                mensaje: `⚠️ Se perdió el pedido. Escribe *HOLA* para reiniciar.`,
                nuevoEstado: "INICIO"
            };
        }

        return {
            tipo: "CONFIRMAR",
            mensaje: `📝 *RESUMEN*\n\n${combo.emoji} ${combo.nombre}\n💵 
$${this.formatPrecio(combo.precio)}\n📍 ${msg}\n⏱️ ${combo.tiempo}\n\n¿Confirmas?\n✅ 
*SI* / ❌ *NO*`,
            nuevoEstado: "ESPERANDO_CONFIRMACION",
            direccionData: msg,
            comboData: combo
        };
    }

    handleConfirmacion(msg, sesion, userId) {
        const combo = sesion.combo;
        const direccion = sesion.direccion;

        if (!combo) {
            this.limpiarSesion(userId);
            return { tipo: "ERROR", mensaje: "⚠️ Error de sesión. *RESET*", nuevoEstado: 
"INICIO" };
        }

        if (msg.includes('si') || msg.includes('sí') || msg === 'dale' || msg === 'ya') 
{
            try {
                const pedidoId = db.savePedido(userId, combo, direccion);
                this.limpiarSesion(userId);
                return {
                    tipo: "PEDIDO_CONFIRMADO",
                    mensaje: `🎉 *PEDIDO #${pedidoId} CONFIRMADO!*\n\n🍔 
${combo.nombre}\n📍 ${direccion}\n⏱️ ${combo.tiempo}\n\nNelson ya sabe que debes comer. 
_No hagas "order anxiety"_ 🍔`,
                    nuevoEstado: "COMPLETADO"
                };
            } catch(e) {
                return {
                    tipo: "ERROR",
                    mensaje: `⚠️ Error guardando, pero anoté: ${combo.nombre} para 
${direccion}`,
                    nuevoEstado: "INICIO"
                };
            }
        }
        
        if (msg.includes('no') || msg === 'nop') {
            this.limpiarSesion(userId);
            return {
                tipo: "CANCELADO",
                mensaje: `🫠 Cancelado. Escribe *HOLA* para nuevo intento.`,
                nuevoEstado: "INICIO"
            };
        }

        return {
            tipo: "CONFUSION",
            mensaje: `🤷 ¿Sí o No? Escribe *SI* para confirmar o *NO* para cancelar.`,
            nuevoEstado: "ESPERANDO_CONFIRMACION"
        };
    }

    generarMenu() {
        let menu = "";
        for (const [num, combo] of Object.entries(this.combos)) {
            menu += `${num}. ${combo.emoji} *${combo.nombre}*\n   ${combo.desc}\n   💰 
$${this.formatPrecio(combo.precio)}\n\n`;
        }
        return menu.trim();
    }

    detectarCombo(msg) {
        if (this.combos[msg]) return this.combos[msg];
        for (const combo of Object.values(this.combos)) {
            if (combo.keywords.some(k => msg.includes(k))) return combo;
        }
        return null;
    }

    debeEscalar(msg) {
        const palabras = ['hablar con nelson', 'tio burger', 'tío burger', 'reclamo', 
'queja', 'mala atencion', 'devolucion', 'hablar con humano', 'persona real', 'gerente', 
'dueño'];
        return palabras.some(p => msg.includes(p));
    }

    detectarRazonEscalacion(msg) {
        if (msg.includes('reclamo') || msg.includes('queja')) return 'RECLAMO';
        return 'CONSULTA';
    }

    resetearSesion(userId) {
        this.limpiarSesion(userId);
        return { tipo: "RESET", mensaje: "🔄 Reiniciado. Escribe *HOLA*", nuevoEstado: 
"INICIO" };
    }

    limpiarSesion(userId) {
        try {
            db.saveSession(userId, { estado: "INICIO", combo: null, direccion: null });
        } catch(e) {}
    }

    formatPrecio(n) {
        return n.toLocaleString('es-CL');
    }
}

module.exports = new TioBurgerBrain();