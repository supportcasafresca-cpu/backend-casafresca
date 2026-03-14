let serverStartTime;

// Variable para almacenar los pedidos nuevos
let newOrders = [];

// Function to update the server uptime display
function updateUptime() {
    if (!serverStartTime) return;
    
    const now = new Date();
    const diffMs = now - serverStartTime;

    const seconds = Math.floor((diffMs / 1000) % 60);
    const minutes = Math.floor((diffMs / (1000 * 60)) % 60);
    const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    document.getElementById('uptime').textContent =
        `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// Function to fetch server status and update the dashboard
async function fetchServerStatus() {
    try {
        const response = await fetch('/api/server-status');
        const data = await response.json();
        
        // Update server start time if not already set
        if (!serverStartTime) {
            serverStartTime = new Date(data.startTime);
            document.getElementById('start-time').textContent = 
                new Date(data.startTime).toLocaleString('es-ES', { 
                    timeZone: 'America/Havana' 
                });
        }

        // Update logs
        const logOutput = document.getElementById('log-output');
        logOutput.innerHTML = ''; // Clear previous logs
        data.logs.forEach(log => {
            const logEntry = document.createElement('div');
            logEntry.classList.add('log-entry');
            logEntry.textContent = log;
            logOutput.appendChild(logEntry);
        });
        logOutput.scrollTop = logOutput.scrollHeight; // Auto-scroll to bottom
    } catch (error) {
        console.error('Error fetching server status:', error);
    }
}

// Function to fetch and update statistics
async function updateStatistics() {
    try {
        const response = await fetch('/obtener-estadisticas');
        const stats = await response.json();

        document.getElementById('total-requests').textContent = stats.length;

        if (stats.length > 0) {
            const lastStat = stats[stats.length - 1];
            document.getElementById('last-request').textContent =
                `${lastStat.fecha_hora_entrada} desde ${lastStat.pais} (${lastStat.ip})`;

            const uniqueIPs = new Set(stats.map(s => s.ip));
            document.getElementById('unique-users').textContent = uniqueIPs.size;

            const recurringUsers = stats.filter(s => s.tipo_usuario === 'Recurrente').length;
            document.getElementById('recurring-users').textContent = recurringUsers;
        } else {
            document.getElementById('last-request').textContent = 'N/A';
            document.getElementById('unique-users').textContent = '0';
            document.getElementById('recurring-users').textContent = '0';
        }
    } catch (error) {
        console.error('Error fetching statistics:', error);
        document.getElementById('total-requests').textContent = 'Error';
        document.getElementById('last-request').textContent = 'Error';
        document.getElementById('unique-users').textContent = 'Error';
        document.getElementById('recurring-users').textContent = 'Error';
    }
}

// Function to clear the console (client-side only)
function clearConsole() {
    document.getElementById('log-output').innerHTML = '';
}

// Function to copy logs to clipboard
function copyLogsToClipboard() {
    const logOutput = document.getElementById('log-output');
    const logsText = logOutput.innerText;
    
    navigator.clipboard.writeText(logsText)
        .then(() => alert('Logs copiados al portapapeles!'))
        .catch(err => {
            console.error('Error al copiar los logs:', err);
            alert('Error al copiar los logs. Por favor, inténtalo de nuevo.');
        });
}

// Function to clear statistics with better error handling
async function clearStatistics() {
    if (!confirm('¿Estás seguro de que deseas eliminar todas las estadísticas?\nEsta acción no se puede deshacer.')) {
        return;
    }

    try {
        const response = await fetch('/api/clear-statistics', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok && data.success) {
            alert('Estadísticas limpiadas correctamente');
            // Actualizar la vista
            await updateStatistics();
            await fetchServerStatus();
        } else {
            throw new Error(data.error || 'Error desconocido al limpiar las estadísticas');
        }
    } catch (error) {
        console.error('Error al limpiar estadísticas:', error);
        alert(error.message || 'Error al limpiar las estadísticas. Por favor, intenta de nuevo.');
    }
}

// Función para obtener datos remotos desde GitHub
async function fetchRemoteData() {
    const remoteUrl = "https://raw.githubusercontent.com/HCoreBeat/Analytics-Montaque/main/data/estadistica.json";

    try {
        const response = await fetch(remoteUrl);
        if (!response.ok) {
            throw new Error(`Error al obtener datos remotos: ${response.statusText}`);
        }
        const remoteData = await response.json();
        return remoteData;
    } catch (error) {
        console.error("Error al obtener datos remotos:", error);
        alert("No se pudieron obtener los datos remotos. Verifica tu conexión a internet.");
        return [];
    }
}

// Función para comparar datos locales con remotos y filtrar pedidos nuevos
async function findNewOrders() {
    try {
        // Obtener datos locales
        const response = await fetch('/obtener-estadisticas');
        const localData = await response.json();

        // Obtener datos remotos
        const remoteData = await fetchRemoteData();

        // Filtrar pedidos nuevos
        newOrders = localData.filter(localItem => {
            // Verificar que el registro local tiene compras
            const isOrder = Array.isArray(localItem.compras) && localItem.compras.length > 0;

            if (!isOrder) {
                return false; // No es un pedido, ignorar
            }

            // Verificar si el pedido ya existe en los datos remotos
            return !remoteData.some(remoteItem => {
                return (
                    Array.isArray(remoteItem.compras) && remoteItem.compras.length > 0 &&
                    remoteItem.ip === localItem.ip &&
                    remoteItem.fecha_hora_entrada === localItem.fecha_hora_entrada
                );
            });
        });

        console.log("Pedidos nuevos:", newOrders);
        updateNewOrdersCount();

    } catch (error) {
        console.error("Error al comparar datos locales y remotos:", error);
        alert("Ocurrió un error al comparar los datos locales y remotos.");
    }
}

// Function to show the number of new orders
function updateNewOrdersCount() {
    const countElement = document.getElementById('new-orders-count');
    countElement.textContent = newOrders.length;
    const button = document.getElementById('new-orders-button');
    button.style.display = newOrders.length > 0 ? 'block' : 'none';
}

// Función para mostrar los pedidos nuevos en el panel
function showNewOrdersPanel() {
    const panel = document.getElementById('new-orders-panel');
    const ordersList = document.getElementById('orders-list');

    // Limpiar contenido previo
    ordersList.textContent = '';

    // Agregar cada pedido en formato JSON con un botón para copiar
    newOrders.forEach((order, index) => {
        const orderContainer = document.createElement('div');
        orderContainer.style.marginBottom = '15px';
        orderContainer.style.padding = '15px';
        orderContainer.style.border = '1px solid #ddd';
        orderContainer.style.borderRadius = '5px';
        orderContainer.style.background = '#fff';
        orderContainer.style.overflow = 'auto';
        orderContainer.style.maxHeight = '200px';

        const orderJson = JSON.stringify(order, null, 2);

        const orderText = document.createElement('pre');
        orderText.textContent = orderJson;
        orderText.style.whiteSpace = 'pre-wrap';
        orderText.style.wordBreak = 'break-word';
        orderText.style.margin = '0';
        orderText.style.fontSize = '14px';
        orderText.style.lineHeight = '1.5';
        orderText.style.color = '#333';
        orderText.style.background = '#f4f4f4';
        orderText.style.padding = '10px';
        orderText.style.borderRadius = '5px';

        const copyButton = document.createElement('button');
        copyButton.textContent = 'Copiar JSON';
        copyButton.style.marginTop = '10px';
        copyButton.style.background = '#007bff';
        copyButton.style.color = 'white';
        copyButton.style.border = 'none';
        copyButton.style.borderRadius = '5px';
        copyButton.style.padding = '5px 10px';
        copyButton.style.cursor = 'pointer';

        copyButton.addEventListener('click', () => {
            navigator.clipboard.writeText(orderJson).then(() => {
                alert(`Pedido ${index + 1} copiado al portapapeles.`);
            }).catch(err => {
                console.error('Error al copiar el JSON:', err);
                alert('Error al copiar el JSON. Por favor, intenta de nuevo.');
            });
        });

        orderContainer.appendChild(orderText);
        orderContainer.appendChild(copyButton);
        ordersList.appendChild(orderContainer);
    });

    panel.style.display = 'block';
}

// Función para cerrar el panel
function closeNewOrdersPanel() {
    const panel = document.getElementById('new-orders-panel');
    panel.style.display = 'none';
}

// Initialize dashboard
function initDashboard() {
    // Update uptime every second
    setInterval(updateUptime, 1000);

    // Update server status and statistics every 3 seconds
    setInterval(() => {
        fetchServerStatus();
        updateStatistics();
    }, 30000);

    // Initial update
    fetchServerStatus();
    updateStatistics();
}

// Start dashboard when page loads
window.addEventListener('load', initDashboard);

// Asegurar que los eventos se agreguen después de que el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', () => {
    const newOrdersButton = document.getElementById('new-orders-button');
    const closeOrdersPanel = document.getElementById('close-orders-panel');

    if (newOrdersButton) {
        newOrdersButton.addEventListener('click', showNewOrdersPanel);
    } else {
        console.error('Elemento con ID "new-orders-button" no encontrado.');
    }

    if (closeOrdersPanel) {
        closeOrdersPanel.addEventListener('click', closeNewOrdersPanel);
    } else {
        console.error('Elemento con ID "close-orders-panel" no encontrado.');
    }

    // Asociar el botón de actualización con la función updateData
    const updateButton = document.getElementById('update-comparison-button');
    if (updateButton) {
        updateButton.addEventListener('click', updateData);
    }
});

// Call the function to find new orders when the page loads
window.onload = () => {
    findNewOrders();
};

// Verificar nuevos pedidos al cargar la página
window.addEventListener('DOMContentLoaded', async () => {
    try {
        // Hacer una solicitud a la API para actualizar la comparación
        const response = await fetch('/api/update-comparison', { method: 'POST' });
        const data = await response.json();

        if (data.success && data.newOrders.length > 0) {
            console.log(`Se encontraron ${data.newOrders.length} nuevos pedidos.`);

            // Mostrar el botón new-orders-button
            const newOrdersButton = document.getElementById('new-orders-button');
            if (newOrdersButton) {
                newOrdersButton.style.display = 'block';
            }
        } else {
            console.log('No se encontraron nuevos pedidos.');
        }
    } catch (error) {
        console.error('Error al verificar nuevos pedidos:', error);
    }
});

function clearOrdersPanel() {
    const panel = document.getElementById('new-orders-panel');
    const ordersList = document.getElementById('orders-list');

    // Limpiar contenido del panel
    ordersList.textContent = '';

    // Ocultar el panel si está activo
    if (panel.classList.contains('active')) {
        panel.classList.remove('active');
    }
}

// Mostrar notificación en la parte superior de la pantalla
function showNotification(message, type = 'info') {
    const notificationPanel = document.getElementById('notification-panel');
    if (!notificationPanel) {
        console.error('No se encontró el elemento #notification-panel');
        return;
    }

    const notification = document.createElement('div');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notificationPanel.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 10000); // Mantener duración de 10 segundos
}

function showNotificationPanel(message, type = 'info') {
    const notificationPanel = document.getElementById('notification-panel');
    const notificationMessage = document.createElement('div');
    notificationMessage.textContent = message;
    notificationMessage.className = `notification ${type}`;
    notificationPanel.appendChild(notificationMessage);

    setTimeout(() => {
        notificationMessage.remove();
    }, 5000);
}

// Llamar a esta función después de limpiar estadísticas
async function handleClearStatistics() {
    try {
        const response = await fetch('/api/clear-statistics', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            showNotificationPanel('Estadísticas limpiadas correctamente.', 'success');

            // Vaciar la lista de pedidos nuevos
            newOrders = [];

            // Limpiar el contenido del panel de pedidos
            const ordersList = document.getElementById('orders-list');
            ordersList.textContent = '';

            // Ocultar el botón de pedidos
            const newOrdersButton = document.getElementById('new-orders-button');
            newOrdersButton.classList.add('hidden');

            // Ocultar el panel si está activo
            const panel = document.getElementById('new-orders-panel');
            if (panel.classList.contains('active')) {
                panel.classList.remove('active');
            }

            // Mostrar notificación de comparación
            if (result.newOrders.length > 0) {
                showNotificationPanel(`Se encontraron ${result.newOrders.length} nuevos pedidos.`, 'info');
            } else {
                showNotificationPanel('No hay nuevos pedidos.', 'info');
            }
        } else {
            throw new Error(result.error || 'Error desconocido al limpiar estadísticas.');
        }
    } catch (error) {
        console.error('Error al limpiar estadísticas:', error);
        showNotificationPanel('Error al limpiar estadísticas. Por favor, intenta de nuevo.', 'error');
    }
}

async function handleUpdateComparison() {
    try {
        const response = await fetch('/api/update-comparison', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            newOrders = result.newOrders;
            updateNewOrdersCount();

            if (newOrders.length > 0) {
                showNotificationPanel(`Se encontraron ${newOrders.length} nuevos pedidos.`, 'info');
            } else {
                showNotificationPanel('No hay nuevos pedidos.', 'info');
            }
        } else {
            throw new Error(result.error || 'Error desconocido al actualizar comparación.');
        }
    } catch (error) {
        console.error('Error al actualizar comparación:', error);
        showNotificationPanel('Error al actualizar comparación. Por favor, intenta de nuevo.', 'error');
    }
}

// Mostrar notificación al actualizar
async function updateData() {
    showNotification('Actualizando datos...', 'info');

    try {
        const response = await fetch('/api/update-comparison', { method: 'POST' }); // Cambiado a POST
        const data = await response.json();

        if (data.success) {
            showNotification('Datos actualizados correctamente.', 'success');
        } else {
            showNotification('Error al actualizar los datos.', 'error');
        }
    } catch (error) {
        showNotification('Error de conexión al actualizar.', 'error');
    }
}

// Unificar manejo de visibilidad del botón de pedidos
function updateNewOrdersButtonVisibility() {
    const button = document.getElementById('new-orders-button');
    if (newOrders.length > 0) {
        button.style.display = 'block';
    } else {
        button.style.display = 'none';
    }
}

// Llamar esta función después de actualizar pedidos
updateNewOrdersButtonVisibility();

// --- POLLING AUTOMÁTICO DE NUEVOS PEDIDOS ---
setInterval(async () => {
    try {
        const response = await fetch('/api/update-comparison', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            // Actualizar variable global y contador
            newOrders = data.newOrders;
            updateNewOrdersCount();
            // Actualizar lista de pedidos en el panel si está abierto
            const panel = document.getElementById('new-orders-panel');
            if (panel && panel.style.display === 'block') {
                const ordersList = document.getElementById('orders-list');
                ordersList.textContent = '';
                newOrders.forEach((order, index) => {
                    const orderContainer = document.createElement('div');
                    orderContainer.style.marginBottom = '15px';
                    orderContainer.style.padding = '15px';
                    orderContainer.style.border = '1px solid #ddd';
                    orderContainer.style.borderRadius = '5px';
                    orderContainer.style.background = '#fff';
                    orderContainer.style.overflow = 'auto';
                    orderContainer.style.maxHeight = '200px';
                    const orderJson = JSON.stringify(order, null, 2);
                    const orderText = document.createElement('pre');
                    orderText.textContent = orderJson;
                    orderText.style.whiteSpace = 'pre-wrap';
                    orderText.style.wordBreak = 'break-word';
                    orderText.style.margin = '0';
                    orderText.style.fontSize = '14px';
                    orderText.style.lineHeight = '1.5';
                    orderText.style.color = '#333';
                    orderText.style.background = '#f4f4f4';
                    orderText.style.padding = '10px';
                    orderText.style.borderRadius = '5px';
                    const copyButton = document.createElement('button');
                    copyButton.textContent = 'Copiar JSON';
                    copyButton.style.marginTop = '10px';
                    copyButton.style.background = '#007bff';
                    copyButton.style.color = 'white';
                    copyButton.style.border = 'none';
                    copyButton.style.borderRadius = '5px';
                    copyButton.style.padding = '5px 10px';
                    copyButton.style.cursor = 'pointer';
                    copyButton.addEventListener('click', () => {
                        navigator.clipboard.writeText(orderJson).then(() => {
                            alert(`Pedido ${index + 1} copiado al portapapeles.`);
                        }).catch(err => {
                            console.error('Error al copiar el JSON:', err);
                            alert('Error al copiar el JSON. Por favor, intenta de nuevo.');
                        });
                    });
                    orderContainer.appendChild(orderText);
                    orderContainer.appendChild(copyButton);
                    ordersList.appendChild(orderContainer);
                });
            }
        }
    } catch (error) {
        console.error('Error al verificar nuevos pedidos (polling):', error);
    }
}, 10000); // Cada 10 segundos

// Actualizar el saludo para incluir la hora actual
function updateGreetingAndBackground() {
    const greetingElement = document.getElementById('dynamic-greeting');
    const now = new Date();
    const hour = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');

    let greetingMessage = '';
    let backgroundClass = '';

    if (hour >= 6 && hour < 12) {
        greetingMessage = `🌅 Buenos días - ${hour}:${minutes}`;
        backgroundClass = 'morning';
    } else if (hour >= 12 && hour < 18) {
        greetingMessage = `☀️ Buenas tardes - ${hour}:${minutes}`;
        backgroundClass = 'afternoon';
    } else {
        greetingMessage = `🌙 Buenas noches - ${hour}:${minutes}`;
        backgroundClass = 'night';
    }

    // Actualizar el mensaje de saludo
    greetingElement.textContent = greetingMessage;

    // Cambiar la clase del banner para el fondo dinámico
    greetingElement.className = `greeting ${backgroundClass}`;
}

// Llamar a la función al cargar la página y actualizar cada minuto
updateGreetingAndBackground();
setInterval(updateGreetingAndBackground, 60000);
