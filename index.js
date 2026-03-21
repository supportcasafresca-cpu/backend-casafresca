const express = require("express");
const fs = require("fs");
const cors = require("cors");
const lockfile = require("proper-lockfile");
const { utcToZonedTime, format: formatTz } = require('date-fns-tz');
const os = require('os');
const fetch = require("node-fetch");
exports.fetch = fetch;

const admin = require('firebase-admin');

// Inicializar con la variable de entorno de Render
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
exports.app = app;

// Servir archivos estáticos desde la carpeta public
app.use(express.static('public'));

// Array para almacenar los logs del servidor
const serverLogs = [];

// Variable para almacenar la fecha de inicio del servidor
const serverStartTime = new Date();

// Helper: obtener la hora actual en una timezone y formatearla YYYY-MM-DD HH:mm:ss
function nowInTimeZone(timeZone) {
    const now = new Date();
    const zonedDate = utcToZonedTime(now, timeZone);
    return formatTz(zonedDate, 'yyyy-MM-dd HH:mm:ss', { timeZone });
}

// Función para añadir logs y mantener un tamaño limitado
function addLog(message) {
    const timestamp = nowInTimeZone('America/Havana');
    serverLogs.push(`[${timestamp}] ${message}`);
    // Mantener solo los últimos 100 logs para evitar sobrecargar la memoria
    if (serverLogs.length > 100) {
        serverLogs.shift(); // Eliminar el log más antiguo
    }
}

// Configuración de CORS
const allowedOrigins = [
    "https://casa-fresca.onrender.com",
    "https://backend-casafresca.onrender.com",
    "https://analytics-casafresca.onrender.com",
    "http://127.0.0.1:5500",
    "http://localhost:10000",
    'https://localhost',                      // Capacitor Android
    'capacitor://localhost',                  // Capacitor iOS
    'http://localhost',                       // Pruebas en navegador
    'http://localhost:8100',                   // Ionic Dev Server
    "http://localhost:5500"
];

app.use(cors({
    origin: function (origin, callback) {
        // Permitir peticiones sin origen (como aplicaciones móviles o curl)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'El policy de CORS para este sitio no permite acceso desde el origen especificado.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-New-Orders'], // Importante incluir tus headers personalizados
    credentials: true
}));

// Middleware para procesar JSON
app.use(express.json());

// Función maestra para enviar el push
async function enviarNotificacionNuevoPedido(cantidad) {
    const mensaje = {
        notification: {
            title: '¡Nuevo Pedido en Casa Fresca! 📦',
            body: `Tienes ${cantidad} pedido(s) nuevo(s) por procesar.`,
        },
        // Usamos un 'topic' para no tener que manejar tokens individuales por ahora
        topic: 'admin_pedidos', 
        android: {
            priority: 'high', // Esto es lo que despierta la app si está cerrada
            notification: {
                sound: 'default',
                clickAction: 'FCM_PLUGIN_ACTIVITY',
                icon: 'stock_ticker_update' 
            }
        }
    };

    try {
        await admin.messaging().send(mensaje);
        addLog("Notificación Push enviada correctamente.");
    } catch (error) {
        addLog(`Error enviando Push: ${error.message}`);
    }
}

// Configuración de rutas y archivos
const path = require('path');
const directoryPath = path.join(__dirname, "data");
const filePath = path.join(directoryPath, "estadistica.json");

// Función para asegurar que el archivo de estadísticas existe
async function ensureStatisticsFile() {
    try {
        // Crear directorio si no existe
        if (!fs.existsSync(directoryPath)) {
            await fs.promises.mkdir(directoryPath, { recursive: true });
            addLog(`Directorio creado: ${directoryPath}`);
        }

        // Crear archivo si no existe
        if (!fs.existsSync(filePath)) {
            await fs.promises.writeFile(filePath, JSON.stringify([], null, 2), 'utf8');
            addLog(`Archivo creado: ${filePath}`);
        }
    } catch (error) {
        addLog(`ERROR: No se pudo crear el archivo de estadísticas: ${error.message}`);
        throw error;
    }
}

// Inicializar archivo de estadísticas al arrancar
ensureStatisticsFile().catch(error => {
    console.error('Error al inicializar archivo de estadísticas:', error);
});


// Función para sanear JSON malformado
function sanitizeJSON(data) {
    try {
        return JSON.parse(data);
    } catch (error) {
        addLog(`WARN: El archivo JSON está malformado. Intentando corregirlo... Error: ${error.message}`);
        const sanitizedData = data
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\n/g, "")
            .replace(/\\t/g, "")
            .replace(/\\r/g, "");
        try {
            return JSON.parse(sanitizedData);
        } catch (finalError) {
            addLog(`ERROR: No se pudo corregir el JSON malformado: ${finalError.message}`);
            return [];
        }
    }
}

// Middleware para registro de solicitudes
app.use((req, res, next) => {
    addLog(`Solicitud: ${req.method} ${req.path}`);
    next();
});


// Usamos (.*) para indicar que el parámetro 'id' puede capturar cualquier carácter
// Usamos una expresión regular para capturar todo después de /p/
// El (.*) captura cualquier carácter y lo guarda en req.params[0]
app.get(/^\/p\/(.*)/, async (req, res) => {
    // 1. Captura del ID desde el array de params (índice 0 debido a la regex)
    let id = req.params[0] || "";

    // Limpieza: quitar barras finales y decodificar
    if (id.endsWith('/')) id = id.slice(0, -1);
    try { 
        id = decodeURIComponent(id); 
    } catch (e) {
        console.error("Error decodificando ID:", e);
    }

    console.log(`[Backend] Procesando producto: "${id}"`);

    const PRODUCTS_URL = "https://raw.githubusercontent.com/supportcasafresca-cpu/Casa-Fresca/refs/heads/main/Json/products.json";

    try {
        const response = await fetch(`${PRODUCTS_URL}?v=${Date.now()}`);

        if (!response.ok) throw new Error(`Fetch fallido: ${response.status}`);

        const json = await response.json();
        
        // Búsqueda en el JSON
        const product = Array.isArray(json.products) && json.products.find(p => {
            const prodId = String(p.id).trim();
            const prodNombreEscaped = _escapeHtml(p.nombre).trim();
            const searchId = String(id).trim();
            return prodId === searchId || prodNombreEscaped === searchId;
        });

        if (!product) {
            console.log(`[Backend] Producto "${id}" no encontrado.`);
            return res.send(`<!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta property="og:title" content="Producto no encontrado - Casa Fresca" />

            <link rel="icon" href="https://casa-fresca.onrender.com/Img/favicon.ico" type="image/x-icon" />
            <link rel="shortcut icon" href="https://casa-fresca.onrender.com/Img/favicon.ico" />

            <meta property="og:image" content="https://casa-fresca.onrender.com/Img/social-share-banner.jpg" />
        </head>
        <body><script>window.location.href = "https://casa-fresca.onrender.com/index.html";</script></body>
        </html>`);
        }

        // =====================
        // CÁLCULO DE PRECIOS
        // =====================
        let precioActual = product.precio;
        let precioAntes = null;

        if (product.oferta === true && product.descuento > 0) {
            precioAntes = product.precio;
            precioActual = (
                product.precio - (product.precio * (product.descuento / 100))
            ).toFixed(2);
        }

        // Datos para Meta Tags
        const nombre = product.nombre || "Producto";
        const descripcion = product.descripcion || "Disponible en Casa Fresca";
        const imagen = (product.imagenes && product.imagenes.length) 
            ? `https://raw.githubusercontent.com/supportcasafresca-cpu/Casa-Fresca/refs/heads/main/Img/products/${encodeURIComponent(product.imagenes[0])}`
            : "https://casa-fresca.onrender.com/Img/social-share-banner.jpg";

        // IMPORTANTE: URL absoluta para WhatsApp
        const canonicalUrl = `https://casa-fresca.onrender.com/p/${encodeURIComponent(id)}`;

        res.send(`<!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>${_escapeHtml(nombre)}</title>

            <link rel="icon" href="https://casa-fresca.onrender.com/Img/favicon.ico" type="image/x-icon" />
            <link rel="shortcut icon" href="https://casa-fresca.onrender.com/Img/favicon.ico" />

            <meta property="og:site_name" content="Casa Fresca" />

            <meta property="og:title" content="${_escapeHtml(nombre)}" />
            <meta property="og:description" content="${_escapeHtml(descripcion)}" />
            <meta property="og:image" content="${imagen}" />
            <meta property="og:url" content="${canonicalUrl}" />
            <meta name="twitter:card" content="summary_large_image" />


            <meta property="product:price:amount" content="${precioActual}" />
            <meta property="product:price:currency" content="Zelle" />

            ${precioAntes !== null ? `
            <meta property="product:original_price:amount" content="${precioAntes}" />
            <meta property="product:original_price:currency" content="Zelle" />
            ` : ""}
        </head>
        <body>
            <script>
                // Redirigir al index usando el hash que lee tu script.js
                window.location.href = "https://casa-fresca.onrender.com/index.html#" + encodeURIComponent("${id}");
            </script>
        </body>
        </html>`);
    } catch (err) {
        console.error("Error en /p/:", err);
        res.status(500).send("Error interno");
    }
});

// Asegúrate de tener esta función definida arriba en tu index.js
function _escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Ruta para guardar estadísticas
app.post("/guardar-estadistica", async (req, res) => {
    let release; // Declare release outside try to ensure it's accessible in finally
    try {
        const nuevaEstadistica = req.body;
        addLog(`Recibida nueva estadística: ${JSON.stringify(nuevaEstadistica)}`);

        if (!nuevaEstadistica.ip || !nuevaEstadistica.pais || !nuevaEstadistica.origen) {
            addLog("ERROR: Faltan campos obligatorios en la estadística.");
            return res.status(400).json({ error: "Faltan campos obligatorios" });
        }

        release = await lockfile.lock(filePath); // Assign release here
        addLog(`Archivo bloqueado: ${filePath}`);

        fs.readFile(filePath, "utf8", (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    fs.writeFileSync(filePath, JSON.stringify([]));
                    data = '[]';
                    addLog(`Archivo no encontrado, inicializando: ${filePath}`);
                } else {
                    addLog(`ERROR: Error leyendo el archivo: ${err.message}`);
                    if (release) release(); // Ensure unlock on error
                    return res.status(500).json({ error: "Error leyendo el archivo" });
                }
            }

            const estadisticas = data ? sanitizeJSON(data) : [];
            const usuarioExistente = estadisticas.find(est => est.ip === nuevaEstadistica.ip);

            const fechaHoraCuba = nowInTimeZone('America/Havana');

            estadisticas.push({
                ip: nuevaEstadistica.ip,
                pais: nuevaEstadistica.pais,
                fecha_hora_entrada: fechaHoraCuba,
                origen: nuevaEstadistica.origen,
                afiliado: nuevaEstadistica.afiliado || "Ninguno",
                duracion_sesion_segundos: nuevaEstadistica.duracion_sesion_segundos || 0,
                tiempo_carga_pagina_ms: nuevaEstadistica.tiempo_carga_pagina_ms || 0,
                nombre_comprador: nuevaEstadistica.nombre_comprador || "N/A",
                telefono_comprador: nuevaEstadistica.telefono_comprador || "N/A",
                nombre_persona_entrega: nuevaEstadistica.nombre_persona_entrega || "N/A",
                telefono_persona_entrega: nuevaEstadistica.telefono_persona_entrega || "N/A",
                correo_comprador: nuevaEstadistica.correo_comprador || "N/A",
                direccion_envio: nuevaEstadistica.direccion_envio || "N/A",
                compras: nuevaEstadistica.compras || [],
                precio_compra_total: nuevaEstadistica.precio_compra_total || 0,
                navegador: nuevaEstadistica.navegador || "Desconocido",
                sistema_operativo: nuevaEstadistica.sistema_operativo || "Desconocido",
                tipo_usuario: usuarioExistente ? "Recurrente" : "Único",
                tiempo_promedio_pagina: nuevaEstadistica.tiempo_promedio_pagina || 0,
                fuente_trafico: nuevaEstadistica.fuente_trafico || "Desconocido",
            });

            fs.writeFile(filePath, JSON.stringify(estadisticas, null, 2), (err) => {
                if (err) {
                    addLog(`ERROR: Error guardando el archivo: ${err.message}`);
                    if (release) release(); // Ensure unlock on error
                    return res.status(500).json({ error: "Error guardando el archivo" });
                }
                addLog("Estadística guardada correctamente.");
                if (release) release(); // Unlock on success
                res.json({ message: "Estadística guardada correctamente" });
            });
        });
    } catch (error) {
        addLog(`ERROR: Error en /guardar-estadistica: ${error.message}`);
        if (release) release(); // Ensure unlock on error
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Ruta para obtener estadísticas
app.get("/obtener-estadisticas", async (req, res) => {
    let release; // Declare release outside try
    try {
        addLog("Solicitud para obtener estadísticas.");
        release = await lockfile.lock(filePath); // Assign release here
        addLog(`Archivo bloqueado para lectura: ${filePath}`);

        fs.readFile(filePath, "utf8", (err, data) => {
            if (err && err.code !== "ENOENT") {
                addLog(`ERROR: Error leyendo el archivo de estadísticas: ${err.message}`);
                if (release) release(); // Ensure unlock on error
                return res.status(500).json({ error: "Error leyendo el archivo" });
            }

            const estadisticas = data ? sanitizeJSON(data) : [];
            addLog(`Estadísticas enviadas: ${estadisticas.length} registros.`);
            if (release) release(); // Unlock on success
            res.json(estadisticas);
        });
    } catch (error) {
        addLog(`ERROR: Error en /obtener-estadisticas: ${error.message}`);
        if (release) release(); // Ensure unlock on error
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ** IMPORTANTE: REEMPLAZA ESTA URL CON LA URL DE TU APLICACIÓN WEB DE APPS SCRIPT **
// Esta es la URL que obtuviste al publicar tu script de Google Apps Script como Web App.
const GOOGLE_APPS_SCRIPT_SHEETS_URL = ""; //"https://script.google.com/macros/s/AKfycbzcX8GDu-6sMegdKKAn5DgLMp9E8BzcM6C3j6WttFiAwiU1RhA42eDzAxIgql-Eat2xhA/exec";

const GOOGLE_APPS_SCRIPT_CORREO_URL = "https://script.google.com/macros/s/AKfycby-g_Dtzo4eHPvChIO3Xr-fNGzVgAqhimHsW5zci3CcpwjMUze91kugN51KhNstVpot/exec";

// Ruta POST para recibir los datos del pedido desde el frontend
app.post('/send-pedido', async (req, res) => {
    console.log('📦 Recibida solicitud de pedido desde el frontend.');
    const orderData = req.body;

    if (!orderData) {
        console.error('Error: Datos de pedido vacíos.');
        return res.status(400).json({ success: false, message: 'Datos de pedido no proporcionados.' });
    }

    try {
        // 1. Enviar los datos al primer script (Web App)
        console.log('Enviando datos a Google Apps Script (Principal)...');
        const response = await fetch(GOOGLE_APPS_SCRIPT_CORREO_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData),
        });

        // 2. Enviar los datos al segundo script (Sheets)
        /*console.log('Enviando datos a Google Apps Script (Sheets)...');
        const responseSheets = await fetch(GOOGLE_APPS_SCRIPT_SHEETS_URL,{
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData),
        });*/

        // 3. Procesar las respuestas de texto a JSON de forma segura
        const textResponse1 = await response.text();
        //const textResponse2 = await responseSheets.text();
        
        //let gasResponse, gasResponseSheets;

        // Parseo seguro respuesta 1
        try {
            gasResponse = JSON.parse(textResponse1);
        } catch (e) {
            console.warn('Respuesta 1 no es JSON válido:', textResponse1);
            gasResponse = { status: "error", message: "Respuesta no válida del script principal", raw: textResponse1 };
        }

        // Parseo seguro respuesta 2
        /*try {
            gasResponseSheets = JSON.parse(textResponse2);
        } catch (e) {
            console.warn('Respuesta 2 no es JSON válido:', textResponse2);
            gasResponseSheets = { status: "error", message: "Respuesta no válida del script sheets", raw: textResponse2 };
        }*/

        //console.log('Respuestas recibidas de Google. Actualizando local...');

        // 4. Ejecutar la función local para actualizar la comparación
        try {
            await compareLocalAndRemoteData();
            console.log('Comparación de pedidos actualizada tras nuevo pedido.');
        } catch (updateError) {
            console.error('Error al actualizar comparación tras pedido:', updateError);
            // No detenemos el proceso si falla la actualización local, pero lo logueamos
        }

        // 5. EVALUACIÓN FINAL Y ENVÍO DE UNA ÚNICA RESPUESTA
        const mainSuccess = response.ok && gasResponse.status === "success";
        //const sheetsSuccess = responseSheets.ok && gasResponseSheets.status === "success";

        if (mainSuccess /*&& sheetsSuccess*/) {
            // Caso ideal: Ambos funcionaron
            return res.status(200).json({
                success: true,
                message: 'Pedido enviado correctamente a ambos sistemas.',
                gasResponse: gasResponse,
                //gasResponseSheets: gasResponseSheets
            });
        } else {
            // Caso de error: Al menos uno falló
            console.error('Hubo un error en uno de los servicios externos.');
            return res.status(502).json({ // 502 Bad Gateway es apropiado cuando falla un servicio externo
                success: false,
                message: 'El pedido se procesó parcialmente o hubo un error en los servicios de Google.',
                details: {
                    principal: { success: mainSuccess, response: gasResponse },
                    //sheets: { success: sheetsSuccess, response: gasResponseSheets }
                }
            });
        }

    } catch (error) {
        console.error('❌ Error CRÍTICO en el backend al procesar el pedido:', error);
        
        // Verificamos si los encabezados ya se enviaron para evitar el crash
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: 'Error interno del servidor al procesar el pedido.',
                error: error.message
            });
        }
    }
});


/*
app.post('/delete-order', async (req, res) => {
    const { rows } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, message: "Debes enviar un array de filas" });
    }

    try {
        const response = await fetch(GOOGLE_APPS_SCRIPT_SHEETS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: "deleteMultipleRows",
                rows: rows
            })
        });

        const result = await response.json();

        if (result.status === "success") {
            return res.json({ success: true, message: "Pedido eliminado correctamente" });
        } else {
            return res.status(500).json({ success: false, message: result.message });
        }

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});


app.get('/api/pedidos-sheets', async (req, res) => {
    try {
        const response = await fetch(GOOGLE_APPS_SCRIPT_SHEETS_URL);
        const data = await response.json();

        if (data.status !== "success") {
            return res.status(500).json({ success: false, message: "Error desde Apps Script" });
        }

        const filas = data.data;

        // Agrupar por ip + fecha_hora_entrada
        const pedidosAgrupados = {};

        filas.forEach(fila => {
            const key = fila.ip + "_" + fila.fecha_hora_entrada;

            if (!pedidosAgrupados[key]) {
                pedidosAgrupados[key] = {
                    ip: fila.ip,
                    pais: fila.pais,
                    fecha_hora_entrada: fila.fecha_hora_entrada,
                    origen: fila.origen,
                    afiliado: fila.afiliado,
                    duracion_sesion_segundos: fila.duracion_sesion_segundos,
                    tiempo_carga_pagina_ms: fila.tiempo_carga_pagina_ms,
                    nombre_comprador: fila.nombre_comprador,
                    telefono_comprador: fila.telefono_comprador,
                    nombre_persona_entrega: fila.nombre_persona_entrega,
                    telefono_persona_entrega: fila.telefono_persona_entrega,
                    correo_comprador: fila.correo_comprador,
                    direccion_envio: fila.direccion_envio,
                    compras: [],
                    precio_compra_total: fila.precio_compra_total_pedido,
                    navegador: fila.navegador,
                    sistema_operativo: fila.sistema_operativo,
                    tipo_usuario: fila.tipo_usuario,
                    tiempo_promedio_pagina: fila.tiempo_promedio_pagina,
                    fuente_trafico: fila.fuente_trafico
                };
            }

            pedidosAgrupados[key].compras.push({
                id: fila.id || null,
                name: fila.producto_name,
                quantity: fila.producto_quantity,
                unitPrice: fila.producto_unitPrice,
                discount: fila.producto_discount,
                rowNumber: fila.rowNumber
            });
        });

        res.json({
            success: true,
            pedidos: Object.values(pedidosAgrupados)
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

*/

// Nueva ruta API para obtener el estado del servidor
app.get("/api/server-status", async (req, res) => {
    addLog("Solicitud de estado del servidor recibida");

    try {
        // Memoria (bytes)
        const memory = process.memoryUsage();

        // Calcular uso de CPU del proceso muestreando durante 100ms
        const startUsage = process.cpuUsage();
        const startHrTime = process.hrtime();
        await new Promise(resolve => setTimeout(resolve, 100));
        const elapHr = process.hrtime(startHrTime);
        const elapMicros = (elapHr[0] * 1e6) + (elapHr[1] / 1e3);
        const elapUsage = process.cpuUsage(startUsage);
        const cpuCount = os.cpus().length || 1;
        const cpuPercent = ((elapUsage.user + elapUsage.system) / elapMicros) * 100 / cpuCount;

        res.json({
            status: "running",
            startTime: serverStartTime.toISOString(),
            logs: serverLogs,
            memory: {
                rss: memory.rss,
                heapTotal: memory.heapTotal,
                heapUsed: memory.heapUsed,
                external: memory.external
            },
            cpu: {
                percent: Number(cpuPercent.toFixed(2)),
                cores: cpuCount,
                sampleMs: 100
            }
        });
    } catch (err) {
        addLog(`ERROR: No se pudo calcular uso de CPU/memoria: ${err.message}`);
        res.status(500).json({ error: 'Error obteniendo estadísticas del servidor' });
    }
});

// Modificar la función para guardar automáticamente en comparison.json
async function compareLocalAndRemoteData() {
    const remoteUrl = `https://raw.githubusercontent.com/supportcasafresca-cpu/Analytics-Casa-Fresca/refs/heads/main/Json/my_data.json?v=${Date.now()}`;
    const comparisonFilePath = path.join(directoryPath, "comparison.json");
    let newOrders = [];
    let release;

    try {
        // Leer datos locales
        const localData = JSON.parse(await fs.promises.readFile(filePath, "utf8"));

        // Obtener datos remotos
        const response = await fetch(remoteUrl);

        if (!response.ok) {
            throw new Error(`Error al obtener datos remotos: ${response.statusText}`);
        }
        const remoteData = await response.json();

        // Filtrar pedidos nuevos
        newOrders = localData.filter(localItem => {
            const isOrder = Array.isArray(localItem.compras) && localItem.compras.length > 0;
            if (!isOrder) return false;

            return !remoteData.some(remoteItem => (
                Array.isArray(remoteItem.compras) && remoteItem.compras.length > 0 &&
                remoteItem.ip === localItem.ip &&
                remoteItem.fecha_hora_entrada === localItem.fecha_hora_entrada
            ));
        });

        addLog(`Pedidos nuevos encontrados: ${newOrders.length}`);

        // Guardar los nuevos pedidos en comparison.json
        release = await lockfile.lock(comparisonFilePath);
        addLog(`Archivo comparison.json bloqueado para escritura: ${comparisonFilePath}`);

        await fs.promises.writeFile(
            comparisonFilePath,
            JSON.stringify(newOrders, null, 2),
            "utf8"
        );
        addLog(`Datos de comparación guardados en: ${comparisonFilePath}`);

        return newOrders;
    } catch (error) {
        addLog(`ERROR: No se pudo comparar datos locales y remotos: ${error.message}`);
        throw error;
    } finally {
        if (release) release(); // Liberar el bloqueo del archivo
    }
}

// Ruta para actualizar la comparación de datos y guardar en comparison.json
app.post("/api/update-comparison", async (req, res) => {
    const comparisonFilePath = path.join(directoryPath, "comparison.json");
    let release;

    try {
        const newOrders = await compareLocalAndRemoteData();

        // Bloquear el archivo comparison.json
        release = await lockfile.lock(comparisonFilePath);
        addLog(`Archivo bloqueado para escritura: ${comparisonFilePath}`);

        // Guardar los nuevos pedidos en comparison.json
        await fs.promises.writeFile(
            comparisonFilePath,
            JSON.stringify(newOrders, null, 2),
            "utf8"
        );
        addLog(`Datos de comparación guardados en: ${comparisonFilePath}`);

        // Responder con los nuevos pedidos
        res.json({ success: true, newOrders });
    } catch (error) {
        addLog(`ERROR: No se pudo actualizar la comparación: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (release) release(); // Liberar el bloqueo del archivo
    }
});

// Nueva ruta para limpiar estadísticas usando promesas
app.post("/api/clear-statistics", async (req, res) => {
    try {
        addLog("Solicitud para limpiar estadísticas recibida");

        // Asegurar que el directorio existe
        if (!fs.existsSync(directoryPath)) {
            addLog("Directorio no encontrado. Creando directorio...");
            await fs.promises.mkdir(directoryPath, { recursive: true });
            addLog(`Directorio creado: ${directoryPath}`);
        }

        // Intentar borrar el archivo si existe
        if (fs.existsSync(filePath)) {
            addLog("Archivo de estadísticas encontrado. Eliminando archivo...");
            await fs.promises.unlink(filePath);
            addLog("Archivo de estadísticas eliminado");
        } else {
            addLog("Archivo de estadísticas no encontrado. Se creará uno nuevo.");
        }

        // Crear nuevo archivo con array vacío
        addLog("Creando nuevo archivo de estadísticas...");
        await fs.promises.writeFile(filePath, "[]", { 
            encoding: 'utf8',
            mode: 0o666 // Permisos de lectura y escritura para todos
        });
        addLog("Nuevo archivo de estadísticas creado correctamente");

        // Comparar datos locales y remotos después de limpiar estadísticas
        const newOrders = await compareLocalAndRemoteData();

        res.json({ 
            success: true, 
            message: "Estadísticas limpiadas correctamente", 
            newOrders 
        });

    } catch (error) {
        const errorMessage = `Error al limpiar estadísticas: ${error.message}`;
        addLog(`ERROR: ${errorMessage}`);
        console.error(errorMessage);
        res.status(500).json({ 
            success: false, 
            error: errorMessage 
        });
    }
});

// Ruta para obtener los datos actuales de comparison.json
app.get("/api/get-comparison", async (req, res) => {
    const comparisonFilePath = path.join(directoryPath, "comparison.json");

    try {
        // Leer los datos de comparison.json
        const data = await fs.promises.readFile(comparisonFilePath, "utf8");
        const comparisonData = JSON.parse(data);

        res.json({ success: true, comparisonData });
    } catch (error) {
        addLog(`ERROR: No se pudo leer comparison.json: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al obtener los datos de comparación" });
    }
});

// Endpoint para obtener los pedidos nuevos desde comparison.json
app.get('/api/new-orders', async (req, res) => {
    const comparisonFilePath = path.join(directoryPath, "comparison.json");
    try {
        if (!fs.existsSync(comparisonFilePath)) {
            return res.json({ success: true, newOrders: [] });
        }
        const data = await fs.promises.readFile(comparisonFilePath, 'utf8');
        const newOrders = JSON.parse(data);
        res.json({ success: true, newOrders });
    } catch (error) {
        console.error('Error al leer comparison.json:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Modificar la ruta principal para verificar pedidos nuevos al cargar la página
app.get("/", async (req, res) => {
    addLog("Página principal solicitada");

    try {
        // Verificar si hay pedidos nuevos
        const newOrders = await compareLocalAndRemoteData();

        // Si hay nuevos pedidos, guardar estadísticas y mostrar el botón
        if (newOrders.length > 0) {
            addLog(`Se encontraron ${newOrders.length} nuevos pedidos al cargar la página.`);

            // Guardar estadísticas de los nuevos pedidos
            const estadisticas = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
            newOrders.forEach(order => {
                estadisticas.push(order);
            });
            await fs.promises.writeFile(filePath, JSON.stringify(estadisticas, null, 2), "utf8");
            addLog("Estadísticas de nuevos pedidos guardadas correctamente.");
        }

        // Enviar el archivo HTML con información sobre nuevos pedidos
        res.sendFile(__dirname + '/public/index.html', {
            headers: {
                'X-New-Orders': newOrders.length > 0 ? 'true' : 'false'
            }
        });
    } catch (error) {
        addLog(`ERROR: No se pudo verificar pedidos nuevos al cargar la página: ${error.message}`);
        res.status(500).send("Error interno del servidor");
    }
});

// Manejo de errores
app.use((err, req, res, next) => {
    addLog(`ERROR GLOBAL: ${err.message}`);
    console.error("Error global:", err);
    res.status(500).json({ error: "Error interno del servidor" });
});

// Puerto de escucha
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    addLog(`Servidor corriendo en el puerto ${PORT}`);
    addLog(`Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Servidor corriendo en el puerto ${PORT}`);
    console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
});

// Verificar nuevos pedidos cada 30 segundos
setInterval(async () => {
    try {
        const newOrders = await compareLocalAndRemoteData();

        if (newOrders.length > 0) {
            addLog(`Se encontraron ${newOrders.length} nuevos pedidos en la verificación periódica.`);
            // Llamamos a la notificación
            await enviarNotificacionNuevoPedido(newOrders.length);
        } else {
            addLog("No se encontraron nuevos pedidos en la verificación periódica.");
        }
    } catch (error) {
        addLog(`ERROR: Error en la verificación periódica de nuevos pedidos: ${error.message}`);
    }
}, 30000); // 30 segundos