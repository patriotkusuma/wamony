// src/eventHandlers.js
const { generateQrCodeUrl } = require('./utils/qrGenerator');
const { sendImageToFastAPI } = require('./utils/apiHandler');
const { ADMIN_NUMBER } = require('./config');
const { Buttons } = require('whatsapp-web.js'); // Pastikan Buttons di-import jika digunakan

module.exports = (client, io) => { // Menerima client dan io sebagai parameter
    client.on('qr', async (qr) => {
        console.log(`[${new Date().toLocaleString()}] QR RECEIVED`);
        try {
            const url = await generateQrCodeUrl(qr);
            io.emit('new-qr', url);
            io.emit('message', `[${new Date().toLocaleString()}] QR code received. Scan it!`);
        } catch (err) {
            console.error(`[${new Date().toLocaleString()}] Error generating QR code URL:`, err);
        }
    });

    client.on('ready', () => {
        console.log(`[${new Date().toLocaleString()}] 🤖 Bot siap menerima gambar pembayaran...`);
        io.emit('message', `[${new Date().toLocaleString()}] Whatsapp is ready`);
        io.emit('ready', true);
    });

    client.on('authenticated', (session) => {
        console.log(`[${new Date().toLocaleString()}] Whatsapp is authenticated`);
        io.emit('message', `[${new Date().toLocaleString()}] Whatsapp is authenticated`);
        io.emit('isAuth', true);
        // fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(session)); // Simpan sesi jika diperlukan di sini atau di index.js
    });

    client.on('auth_failure', (reason) => {
        console.error(`[${new Date().toLocaleString()}] Auth failure: ${reason}, restarting ....`);
        io.emit('message', `[${new Date().toLocaleString()}] Auth failure: ${reason}, restarting ....`);
        client.destroy();
        client.initialize();
    });

    client.on('disconnected', (reason) => {
        console.warn(`[${new Date().toLocaleString()}] Disconnected: ${reason}`);
        io.emit('message', `[${new Date().toLocaleString()}] Disconnected: ${reason}`);
        client.destroy();
        client.initialize();
    });

    // Penanganan Pesan Masuk
    client.on('message', async message => {
        if (message.fromMe) {
            return;
        }

        let user = await message.getContact();
        const senderNumber = message.from;

        if (message.body === "!ping") {
            await message.reply("Pong");
        } else if (message.body === "skuy") {
            await message.reply(`Halo kak ${user.id.user}`);
        } else if (message.body === "!button") {
            let button = new Buttons('button body', [{ body: 'bt1' }, { body: 'bt2' }]);
            await client.sendMessage(message.from, button);
        } else if (message.hasMedia && message.type === 'image') {
            console.log(`[${new Date().toLocaleString()}] Pesan gambar masuk dari ${senderNumber}`);
            const media = await message.downloadMedia();
            const buffer = Buffer.from(media.data, 'base64');

            try {
                const result = await sendImageToFastAPI(buffer, media.mimetype, senderNumber);

                const predictedClass = result.prediction ? result.prediction.class : 'Tidak Diketahui';
                const confidence = result.prediction ? result.prediction.confidence : 0;
                const paymentAmount = result.payment_amount;
                const ocrResult = result.ocr_result;

                const confidenceThreshold = 0.7;
                const isConfidentlyRecognizedPayment = confidence > confidenceThreshold && paymentAmount !== null;

                if (isConfidentlyRecognizedPayment) {
                    await message.reply(`Baik kak, terima kasih, pembayaran telah kami terima 🙏 \n\n_* pesan ini dibalas oleh *ai harmony laundry*_`);
                    console.log(`[${new Date().toLocaleString()}] ✔️ Pembayaran valid dari ${senderNumber}. Pesan singkat dikirim ke pelanggan.`);
                } else {
                    console.warn(`[${new Date().toLocaleString()}] ⚠️ Gambar dari ${senderNumber} TIDAK DIKENALI SECARA PASTI (atau bukan bukti pembayaran). Tidak membalas pelanggan secara otomatis.`);
                    console.warn(`   Detail: Prediksi: ${predictedClass}, Confidence: ${confidence}, Nominal: ${paymentAmount}`);

                    await client.sendMessage(ADMIN_NUMBER, media, {
                        caption:
                            `🚨 *PERLU TINJAUAN MANUAL!* 🚨\n` +
                            `Pesan dari: ${senderNumber.replace('@c.us', '')}\n` +
                            `Prediksi Bot: *${predictedClass}* (Conf: ${(confidence * 100).toFixed(2)}%)\n` +
                            `Nominal Terdeteksi: *${paymentAmount ? `Rp ${paymentAmount.toLocaleString('id-ID')}` : 'Tidak Terdeteksi'}*\n` +
                            `Teks OCR Awal:\n${ocrResult.substring(0, 300)}${ocrResult.length > 300 ? '...' : ''}\n\n` +
                            `*Gambar ini tidak dikenali secara pasti oleh AI atau bukan bukti pembayaran.* Mohon periksa dan balas pelanggan secara manual.`,
                        quotedMessageId: message.id._serialized
                    });
                    console.log(`[${new Date().toLocaleString()}] Notifikasi dikirim ke admin ${ADMIN_NUMBER}, mereply pesan asli.`);
                }

            } catch (err) {
                console.error(`[${new Date().toLocaleString()}] ❌ Error saat menghubungi FastAPI untuk ${senderNumber}:`, err.message);
                if (err.response) {
                    console.error(`Detail Error FastAPI (Status: ${err.response.status}, Data:`, err.response.data, ')');
                    io.emit('message', `[${new Date().toLocaleString()}] Error FastAPI dari ${senderNumber}: ${err.response.data.detail || err.response.statusText}`);
                } else if (err.code === 'ECONNREFUSED') {
                    console.error(`[${new Date().toLocaleString()}] FATAL: FastAPI server tidak dapat dijangkau. ${err.message}`);
                    io.emit('message', `[${new Date().toLocaleString()}] FATAL: FastAPI server tidak dapat dijangkau. Mohon periksa server FastAPI.`);
                } else if (err.code === 'ETIMEDOUT' || err.code === 'ERR_NETWORK') {
                    console.error(`[${new Date().toLocaleString()}] Jaringan/Timeout ke FastAPI untuk ${senderNumber}. ${err.message}`);
                    io.emit('message', `[${new Date().toLocaleString()}] Jaringan/Timeout ke FastAPI dari ${senderNumber}.`);
                } else {
                    console.error(`[${new Date().toLocaleString()}] Kesalahan tak terduga saat memproses ${senderNumber}:`, err);
                    io.emit('message', `[${new Date().toLocaleString()}] Kesalahan tak terduga saat memproses ${senderNumber}.`);
                }
            }
        } else if (message.body && message.body.toLowerCase() === '!start') {
            await message.reply('Halo! Kirimkan gambar bukti pembayaran untuk saya deteksi. 😊');
        } else if (message.body && !message.isStatus) {
            console.log(`[${new Date().toLocaleString()}] Menerima pesan teks dari ${senderNumber}: "${message.body}". Tidak memproses otomatis.`);
        }
    });

    // Socket.IO Event Handlers
    io.on('connection', (socket) => {
        socket.emit('message', `${new Date().toLocaleString()} IO connected`);

        socket.on('disconnect-btn', (msg) => {
            console.log(`[${new Date().toLocaleString()}] Disconnect button clicked: ${msg}`);
            client.logout();
        });
    });
};