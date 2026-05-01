const config = require('./config');
const db = require('./database');

class TioBurgerBrain {
    constructor() {
        this.combos = {
            1: { id: "M1", nombre: "Combo Mechada Clásica", desc: "Mechada + papas + bebida", precio: 7600, tiempoRetiro: "5-10 min", tiempoDelivery: "20-25 min", emoji: "🥩", keywords: ['mechada', '1', 'clasica'] },
            2: { id: "C1", nombre: "Combo Cheese Burger", desc: "Cheese Burger + papas + bebida", precio: 6950, tiempoRetiro: "5-10 min", tiempoDelivery: "20-25 min", emoji: "🍔", keywords: ['cheese', '2', 'queso'] },
            3: { id: "D1", nombre: "Dúo Cheddaron", desc: "2 Mechada Cheddaron + papas", precio: 11500, tiempoRetiro: "10-15 min", tiempoDelivery: "25-35 min", emoji: "🧀🔥", keywords: ['cheddaron', '3', 'duo cheddar'] },
            4: { id: "D2", nombre: "Dúo Mechada Z", desc: "2 Mechada Z (para hambres épicas)", precio: 11000, tiempoRetiro: "10-15 min", tiempoDelivery: "25-35 min", emoji: "⚡⚡", keywords: ['mechada z', '4', 'duo z', 'zeta'] }
        };
        console.log('🧠 Brain v2.2 cargado');
    }

    async procesarMensaje(texto, userId) {
        const msg = texto.toLowerCase().trim();

        // KILL SWITCH
        if (msg === 'reset' || msg === 'reiniciar' || msg === 'emergencia') {
            this.limpiarSesion(userId);
            return {
                tipo: "RESET",
                mensaje: "🔄 *Sistema reiniciado.* Escribe *HOLA* para empezar.",
                nuevoEstado: "INICIO"
            };
        }

        try {
            let sesion = db.getSession(userId);
            if (!sesion) {
                sesion = { estado: "INICIO", combo: null, direccion: null, tipo_entrega: null };
            } else {
                if (typeof sesion.combo === 'string') {
                    try { sesion.combo = JSON.parse(sesion.combo); } catch (e) { sesion.combo = null; }
                }
                sesion.direccion = sesion.direccion ?? null;
                sesion.tipo_entrega = sesion.tipo_entrega ?? null;
            }

            // Detectar escalación
            if (this.debeEscalar(msg)) {
                this.limpiarSesion(userId);
                return {
                    tipo: "ESCALAR",
                    mensaje: `🚨 *MODO HUMANO ACTIVADO*\n\nTío Burger fue notificado. Te responde en breve.\n\n_Si es urgente, llama directo._`,
                    accion: "alertar_nelson",
                    data: { razon: this.detectarRazonEscalacion(msg) }
                };
            }

            let resultado;

            // Reinicio rápido si está en medio de flujo y escribe hola/menu
            const estadosFlujo = ["ESPERANDO_COMBO", "ESPERANDO_DIRECCION", "ESPERANDO_CONFIRMACION"];
            if (estadosFlujo.includes(sesion.estado) && (['hola','menu'].includes(msg))) {
                this.limpiarSesion(userId);
                sesion = { estado: "INICIO", combo: null, direccion: null, tipo_entrega: null };
            }

            switch(sesion.estado) {
                case "INICIO":
                    resultado = this.handleInicio(msg, userId);
                    break;
                case "ESPERANDO_TIPO_ENTREGA":
                    resultado = this.handleTipoEntrega(msg, sesion, userId);
                    break;
                case "ESPERANDO_COMBO":
                    resultado = this.handleSeleccionCombo(msg, sesion, userId);
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
                    direccion: resultado.direccionData ?? sesion.direccion ?? null,
                    tipo_entrega: resultado.tipoEntregaData ?? sesion.tipo_entrega ?? null
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
        const tieneHistorial = historial && historial.length > 0;

        if (msg.includes('hola') || msg.includes('menu') || msg.includes('precio') || msg === 'buenas' || msg === 'hey') {
            let menuTexto = `👋 *¿Hambre?* Elegí una opción:\n\n`;
            menuTexto += `1️⃣ Ver promos rápidas\n`;
            menuTexto += `2️⃣ Ver menú completo Kyte\n`;
            if (tieneHistorial) {
                menuTexto += `3️⃣ Repetir último pedido\n`;
            }
            menuTexto += `4️⃣ Hablar con Tío Burger\n\n`;
            menuTexto += `_Escribí el número correspondiente_ 📱`;

            return {
                tipo: "MENU_INICIAL",
                mensaje: menuTexto,
                nuevoEstado: "ESPERANDO_TIPO_ENTREGA"
            };
        }

        return {
            tipo: "CONFUSION",
            mensaje: `🤖 ¿Qué? Escribe *HOLA* para ver opciones.`,
            nuevoEstado: "INICIO"
        };
    }

    handleSeleccionCombo(msg, sesion, userId) {
        const combo = this.detectarCombo(msg);

        if (!combo) {
            return {
                tipo: "ERROR",
                mensaje: `❌ Escribí el *número* (1-4). No me hagas adivinar.`,
                nuevoEstado: "ESPERANDO_COMBO"
            };
        }

        return {
            tipo: "PEDIR_TIPO_ENTREGA",
            mensaje: `✅ *${combo.nombre}*\n💰 $${this.formatPrecio(combo.precio)}\n\n¿Cómo lo querés?\n1️⃣ Retiro en local\n2️⃣ Delivery\n\n_Escribí 1 o 2_`,
            nuevoEstado: "ESPERANDO_TIPO_ENTREGA",
            comboData: combo
        };
    }

    handleDireccion(msg, sesion, userId) {
        const combo = sesion.combo;
        if (!combo) {
            this.limpiarSesion(userId);
            return {
                tipo: "ERROR",
                mensaje: `⚠️ Se perdió el pedido. Escribe *HOLA* para reiniciar.`,
                nuevoEstado: "INICIO"
            };
        }

        if (!msg || msg.length < 5) {
            return {
                tipo: "ERROR",
                mensaje: `🤨 Dirección muy corta. Ejemplo: *Pasaje 9 344, Playa Ancha*`,
                nuevoEstado: "ESPERANDO_DIRECCION"
            };
        }

        // Validación básica de zona: debe tener número de casa/calle
        const tieneNumero = /\d/.test(msg);
        if (!tieneNumero) {
            return {
                tipo: "ERROR",
                mensaje: `🗺️ ¿Y el número de casa/calle? Sin eso el delivery vaga como alma en pena.`,
                nuevoEstado: "ESPERANDO_DIRECCION"
            };
        }

        const tiempo = combo.tiempoDelivery;

        return {
            tipo: "CONFIRMAR",
            mensaje: `📝 *RESUMEN*\n${combo.emoji} ${combo.nombre}\n💵 $${this.formatPrecio(combo.precio)}\n📍 ${msg}\n⏱️ ${tiempo}\n\n¿Confirmas?\n✅ *SI* / ❌ *NO*`,
            nuevoEstado: "ESPERANDO_CONFIRMACION",
            direccionData: msg,
            comboData: combo,
            tipoEntregaData: 'delivery'
        };
    }

    handleConfirmacion(msg, sesion, userId) {
        const combo = sesion.combo;
        const direccion = sesion.direccion;
        const tipoEntrega = sesion.tipo_entrega;

        if (!combo) {
            this.limpiarSesion(userId);
            return { tipo: "ERROR", mensaje: "⚠️ Error de sesión. *RESET*", nuevoEstado: "INICIO" };
        }

        if (msg.includes('si') || msg.includes('sí') || msg === 'dale' || msg === 'ya' || msg === 'ok') {
            try {
                const pedidoId = db.savePedido(userId, combo, direccion, tipoEntrega);
                this.limpiarSesion(userId);

                const tiempo = tipoEntrega === 'retiro' ? combo.tiempoRetiro : combo.tiempoDelivery;
                const entregaTexto = tipoEntrega === 'retiro' ? 'Retiro en local' : direccion;

                return {
                    tipo: "PEDIDO_CONFIRMADO",
                    mensaje: `🎉 *PEDIDO #${pedidoId} CONFIRMADO*\n\n🍔 ${combo.nombre}\n📍 ${entregaTexto}\n⏱️ ${tiempo}\n\n*Tío Burger confirma pago y disponibilidad.*\n_No hagas "order anxiety"_ 🍔`,
                    nuevoEstado: "COMPLETADO"
                };
            } catch(e) {
                return {
                    tipo: "ERROR",
                    mensaje: `⚠️ Error guardando, pero anoté: ${combo.nombre} para ${direccion || 'retiro'}`,
                    nuevoEstado: "INICIO"
                };
            }
        }

        if (msg.includes('no') || msg === 'nop' || msg === 'nope') {
            this.limpiarSesion(userId);
            return {
                tipo: "CANCELADO",
                mensaje: `🫠 Cancelado. Escribe *HOLA* para nuevo intento.`,
                nuevoEstado: "INICIO"
            };
        }

        return {
            tipo: "CONFUSION",
            mensaje: `🤷 ¿Sí o No? Escribí *SI* para confirmar o *NO* para cancelar.`,
            nuevoEstado: "ESPERANDO_CONFIRMACION"
        };
    }

    // Este método maneja el estado ESPERANDO_TIPO_ENTREGA cuando ya hay combo seleccionado
    // o cuando viene del menú inicial
    handleTipoEntrega(msg, sesion, userId) {
        const tieneCombo = sesion.combo !== null;

        // Si no tiene combo, es el menú inicial
        if (!tieneCombo) {
            return this.handleTipoEntregaMenuInicial(msg, sesion, userId);
        }

        const combo = sesion.combo;

        // Retiro
        if (msg === '1' || msg.includes('retiro') || msg.includes('local') || msg.includes('pasar') || msg.includes('ir')) {
            const tiempo = combo.tiempoRetiro;
            return {
                tipo: "CONFIRMAR",
                mensaje: `📝 *RESUMEN*\n${combo.emoji} ${combo.nombre}\n💵 $${this.formatPrecio(combo.precio)}\n🏬 Retiro en local\n⏱️ ${tiempo}\n\n¿Confirmas?\n✅ *SI* / ❌ *NO*`,
                nuevoEstado: "ESPERANDO_CONFIRMACION",
                comboData: combo,
                direccionData: null,
                tipoEntregaData: 'retiro'
            };
        }

        // Delivery
        if (msg === '2' || msg.includes('delivery') || msg.includes('envio') || msg.includes('envío') || msg.includes('domicilio') || msg.includes('mandar')) {
            return {
                tipo: "PEDIR_DIRECCION",
                mensaje: `📍 *¿Dónde te la mando?*\n(dirección completa con número)`,
                nuevoEstado: "ESPERANDO_DIRECCION",
                comboData: combo,
                tipoEntregaData: 'delivery'
            };
        }

        return {
            tipo: "CONFUSION",
            mensaje: `🤖 ¿Retiro o Delivery? Escribí *1* o *2*.`,
            nuevoEstado: "ESPERANDO_TIPO_ENTREGA"
        };
    }

    handleTipoEntregaMenuInicial(msg, sesion, userId) {
        const historial = db.getHistorial(userId);
        const tieneHistorial = historial && historial.length > 0;

        if (msg === '1' || msg.includes('promo') || msg.includes('rapida')) {
            return {
                tipo: "MENU",
                mensaje: `🍔 *PROMOS RÁPIDAS*\n\n` + this.generarMenu() + `\n\n*Escribí el número (1-4)*`,
                nuevoEstado: "ESPERANDO_COMBO"
            };
        }

        if (msg === '2' || msg.includes('kyte') || msg.includes('completo')) {
            return {
                tipo: "MENU_KYTE",
                mensaje: `📲 *Menú completo acá:*\nhttps://thebestburger.ky.te\n\nCuando sepas qué querés, volvé y escribí *HOLA* 🍔`,
                nuevoEstado: "INICIO"
            };
        }

        if (msg === '3' || msg.includes('repetir') || msg.includes('ultimo')) {
            if (!tieneHistorial) {
                return {
                    tipo: "ERROR",
                    mensaje: `🫥 No tengo historial tuyo. Escribí *1* para ver promos.`,
                    nuevoEstado: "ESPERANDO_TIPO_ENTREGA"
                };
            }
            const ultimo = historial[0];
            const combo = this.detectarComboPorNombre(ultimo.combo_nombre);
            if (!combo) {
                return {
                    tipo: "ERROR",
                    mensaje: `🫠 Ese combo ya no está. Escribí *1* para ver las actuales.`,
                    nuevoEstado: "ESPERANDO_TIPO_ENTREGA"
                };
            }

            return {
                tipo: "REPETIR_PEDIDO",
                mensaje: `🔁 *Repetir:* ${combo.nombre}\n💰 $${this.formatPrecio(combo.precio)}\n\n¿Cómo lo querés?\n1️⃣ Retiro en local\n2️⃣ Delivery\n\n_Escribí 1 o 2_`,
                nuevoEstado: "ESPERANDO_TIPO_ENTREGA",
                comboData: combo
            };
        }

        if (msg === '4' || msg.includes('hablar') || msg.includes('tio burger') || msg.includes('tío burger') || msg.includes('humano')) {
            this.limpiarSesion(userId);
            return {
                tipo: "ESCALAR",
                mensaje: `🚨 *MODO HUMANO ACTIVADO*\n\nTío Burger fue notificado. Te responde en breve.`,
                accion: "alertar_nelson",
                data: { razon: "CONSULTA" }
            };
        }

        return {
            tipo: "CONFUSION",
            mensaje: `🤖 Elegí una opción:\n1️⃣ Promos\n2️⃣ Menú Kyte\n${tieneHistorial ? '3️⃣ Repetir último\n' : ''}4️⃣ Hablar con Tío Burger`,
            nuevoEstado: "ESPERANDO_TIPO_ENTREGA"
        };
    }

    generarMenu() {
        let menu = "";
        for (const [num, combo] of Object.entries(this.combos)) {
            menu += `${num}. ${combo.emoji} *${combo.nombre}*\n   ${combo.desc}\n   💰 $${this.formatPrecio(combo.precio)}\n\n`;
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

    detectarComboPorNombre(nombre) {
        if (!nombre) return null;
        const nombreLower = nombre.toLowerCase();
        for (const combo of Object.values(this.combos)) {
            if (nombreLower.includes(combo.nombre.toLowerCase())) return combo;
        }
        // Fallback por palabras clave
        for (const combo of Object.values(this.combos)) {
            if (combo.keywords.some(k => nombreLower.includes(k))) return combo;
        }
        return null;
    }

    debeEscalar(msg) {
        const palabras = ['hablar con nelson', 'reclamo', 'queja', 'mala atencion', 'devolucion', 'hablar con humano', 'persona real', 'gerente', 'dueño'];
        return palabras.some(p => msg.includes(p));
    }

    detectarRazonEscalacion(msg) {
        if (msg.includes('reclamo') || msg.includes('queja')) return 'RECLAMO';
        return 'CONSULTA';
    }

    resetearSesion(userId) {
        this.limpiarSesion(userId);
        return { tipo: "RESET", mensaje: "🔄 Reiniciado. Escribe *HOLA*", nuevoEstado: "INICIO" };
    }

    limpiarSesion(userId) {
        try {
            db.saveSession(userId, { estado: "INICIO", combo: null, direccion: null, tipo_entrega: null });
        } catch(e) {}
    }

    formatPrecio(n) {
        return n.toLocaleString('es-CL');
    }
}

module.exports = new TioBurgerBrain();
