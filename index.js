const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { exec } = require('child_process');
const brain = require('./brain');
const config = require('./config');

console.log(`🚀 Iniciando ${config.nombreNegocio} - Tío Burger Bot v1.3`);

function escapeAppleScript(str = '') {
    return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function notificarMac(titulo, mensaje, sonido = null) {
    const safeTitulo = escapeAppleScript(titulo);
    const safeMensaje = escapeAppleScript(mensaje);

    const script = sonido
        ? `display notification "${safeMensaje}" with title "${safeTitulo}" sound name "${escapeAppleScript(sonido)}"`
        : `display notification "${safeMensaje}" with title "${safeTitulo}"`;

    exec(`osascript -e '${script}'`, (err) => {
        if (err) {
            console.error('Error notificando en mac:', err.message);
        }
    });
}

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './session' }),
    puppeteer: {
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on('qr', (qr) => {
    console.log('\n📱 Escanea con WhatsApp:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot operativo - Modo Tío Burger activado');
    notificarMac('The Best Burger SPA', 'Bot TBB listo', 'Ping');
});

client.on('message', async (msg) => {
    try {
        // Filtros duros
        if (msg.fromMe) return;
        if (!msg.from) return;
        if (msg.from.includes('@g.us')) return; // grupos
        if (msg.from === 'status@broadcast') return; // estados
        if (msg.from.endsWith('@broadcast')) return; // broadcasts varios
        if (msg.type !== 'chat') return; // ignora audios, imágenes, etc por ahora

        console.log(`📩 ${msg.from}: ${msg.body}`);

        // Modo desarrollo: solo whitelist
        if (!config.modoProduccion) {
            if (!config.whitelistDev.includes(msg.from)) {
                console.log(`🚫 Bloqueado: ${msg.from}`);
                return;
            }
        }

        // Typing seguro
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
        } catch (e) {
            console.log('ℹ️ No se pudo marcar typing');
        }

        setTimeout(async () => {
            try {
                const respuesta = await brain.procesarMensaje(msg.body, msg.from);

                if (!respuesta || !respuesta.mensaje) {
                    await msg.reply('⚠️ Error temporal. Escribe *RESET* para reiniciar.');
                    return;
                }

                await msg.reply(respuesta.mensaje);

                // Escalación a Nelson
                if (respuesta.accion === 'alertar_nelson') {
                    const razon = respuesta?.data?.razon || 'CONSULTA';
                    const mensajeMac = `Cliente necesita atención. Tipo: ${razon}`;

                    notificarMac('TBB - Escalación', mensajeMac, 'Submarine');

                    await client.sendMessage(
                        config.telefonoAdmin,
                        `🚨 *ESCALACIÓN TBB*\n\nDe: ${msg.from}\nTipo: ${razon}\nMensaje: "${msg.body}"`
                    );

                    console.log('🚨 Alerta enviada a Nelson');
                }

                // Pedido confirmado
                if (respuesta.tipo === 'PEDIDO_CONFIRMADO') {
                    const match = respuesta.mensaje.match(/#(\d+)/);
                    const numPedido = match ? match[1] : 'N/A';

                    notificarMac('TBB - Venta!', `Nuevo pedido #${numPedido}`, 'Ping');

                    // Opcional: aviso interno al admin por WhatsApp
                    await client.sendMessage(
                        config.telefonoAdmin,
                        `🍔 *NUEVO PEDIDO CONFIRMADO*\n${respuesta.mensaje}`
                    );
                }

            } catch (error) {
                console.error('Error procesando mensaje:', error);
                await msg.reply('⚠️ Error temporal. Escribe *RESET* para reiniciar.');
            }
        }, config.tiempoRespuesta);

    } catch (error) {
        console.error('Error en listener principal:', error);
    }
});

client.on('disconnected', (reason) => {
    console.log('❌ Desconectado:', reason || 'sin detalle');
    notificarMac('TBB Bot', 'WhatsApp se desconectó', 'Basso');
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando bot...');
    try {
        await client.destroy();
    } catch (e) {
        console.error('Error cerrando cliente:', e.message);
    }
    process.exit();
});

client.initialize();