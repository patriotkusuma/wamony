// src/index.js
const fs = require('fs');
const { app, server, io } = require('./app');
const client = require('./whatsappClient');
const { PORT, SESSION_FILE_PATH } = require('./config');
const setupEventHandlers = require('./eventHandlers');
const setupRoutes = require('./routes');

// Inisialisasi WhatsApp Client
client.initialize();

// Setup event handlers untuk WhatsApp Client
setupEventHandlers(client, io);

// Setup routes untuk Express app
setupRoutes(app, client, io);

// Mulai server Express/Socket.IO
server.listen(PORT, () => {
    console.log(`[${new Date().toLocaleString()}] App berjalan di Port ${PORT}`);
});