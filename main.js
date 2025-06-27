require('dotenv').config()
const { Client, LocalAuth, Buttons } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const socketIO = require('socket.io');
const http = require('http');
const express = require('express');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const {Queue} = require('bullmq')
const Redis = require('ioredis')
const fsPromises = require('fs/promises')

const WEBHOOK_LOG_FILE = path.join(__dirname, 'logs','webhook-laravel.log');
const CHAT_LOG_FILE = path.join(__dirname, 'logs','whatsapp_message.log')
const LOGS_DIR = path.join(__dirname, 'logs')

// Konfig redis
// const redisConnection = new Redis({
//     host: process.env.REDIS_HOST || 'localhost',
//     port: parseInt(process.env.REDIS_PORT || '6379'),
//     password: process.env.REDIS_PASSWORD || 'Manisku212',
//     maxRetriesPerRequest: null
// })

// const predictionQueue = new Queue('imagePredictionQueue',{connection:redisConnection})
// console.log(`[${new Date().toLocaleString()}] BullMq Queue 'imagePredictionQueue' initialized.`)

// --- Konfigurasi ---
const SESSION_FILE_PATH = './wtf-session.json';
const PORT = process.env.PORT || 8000;
const FASTAPI_URL = 'https://ai.harmonylaundry.my.id/predict_receipt/'; // <<--- PASTIKAN INI SESUAI
const ADMIN_NUMBER = '6281223008363@c.us'; 
// --- Akhir Konfigurasi ---

let sessionCfg;
if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionCfg = require(SESSION_FILE_PATH);
}


// check the log file
(async () => {
    try{
        await ensureDirectoryExists(LOGS_DIR)
        await ensureFileExists(WEBHOOK_LOG_FILE)
        await ensureFileExists(CHAT_LOG_FILE)
        console.log(`[${new Date().toLocaleString()}] - All necessary file are ready.`)
    }catch(error){
        console.error(`[${new Date().toLocaleString()}] - Failed to create ensure directory `, error)
        throw error
    }
})
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: (_req, callback) => {
            callback(null, true);
        },
        credentials: true
    }
});
app.io = io;

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'harmony-notif'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-gpu',
            '--disable-setuid-sandbox'
        ],
    },
    webVersionCache: {
        type: 'local',
    }
});

client.initialize();

// --- Konfigurasi Middleware Express ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: __dirname });
});

// --- Event Listeners dari WhatsApp-Web.js Client ---
client.on('qr', (qr) => {
    console.log(`[${new Date().toLocaleString()}] QR RECEIVED`);
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error(`[${new Date().toLocaleString()}] Error generating QR code URL:`, err);
            return;
        }
        io.emit('new-qr', url);
        io.emit('message', `[${new Date().toLocaleString()}] QR code received. Scan it!`);
    });
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

// --- Penanganan Pesan Masuk ---
client.on('message', async message => {
    // Abaikan pesan yang dikirim oleh bot itu sendiri (untuk mencegah loop balasan)
    if (message.fromMe) {
        try{
            console.log(`[${new Date().toLocaleString()}] simpan whatsapp ke laravel`)
            await saveMessageToLaravel(message)
        }catch(error){
            console.error(`[${new Date().toLocaleString()}] Gagal menyimpan ke laravel`, error.message)
        }
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
    }
    // Tangani pesan gambar (bukti pembayaran)
    else if (message.hasMedia && message.type === 'image') {
        console.log(`[${new Date().toLocaleString()}] Pesan gambar masuk dari ${senderNumber}`);
        const media = await message.downloadMedia();
        const buffer = Buffer.from(media.data, 'base64');
        const filename = `image.${Date.now()}.${media.mimetype.split('/')[1] ||'jpg'}`
        console.log(`[${new Date().toLocaleString()}] Media berhasil diunduh. Ukuran buffer: ${buffer.length} bytes. MimeType: ${media.mimetype}`);

        if(message.isStatus){
            await fsPromises.appendFile("logs/message.log", `[${new Date().toLocaleString()}] Pesan dari ${senderNumber} merupakan stauts, harus di lewati \n`)
            return 
        }

        await saveMessageToLaravel(message,media,filename,media.mimetype)
        try {
            // const job = await predictionQueue.add(
            //     'processImage',
            //     {
            //         senderNumber: senderNumber,
            //         filename: filename,
            //         imageBufer: buffer.toString('base64'),
            //         mimetype: media.mimetype,
            //         messageId: message.id._serialized
            //     },
            //     {
            //         removeOnComplete: true,
            //         removeOnFail: 50
            //     }
            // )

            // console.log(`[${new Date().toLocaleString()}] ✅ Pekerjaan ditambahkan ke antrian. ID pekerjaan ${job.id}`)
            
            // message.reply

            const formData = new FormData();
            formData.append('file', buffer, {
                filename: 'image.jpg',
                contentType: media.mimetype
            });
            formData.append('sender_number', senderNumber);

            console.log(`[${new Date().toLocaleString()}] Mengirim gambar ke FastAPI dari ${senderNumber}...`);

            const response = await axios.post(FASTAPI_URL, formData, {
                headers: {
                    ...formData.getHeaders(),
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 60000
            });

            const result = response.data;
            console.log(`[${new Date().toLocaleString()}] ✅ Respon FastAPI untuk ${senderNumber}:`, JSON.stringify(result, null, 2));

            const predictedClass = result.prediction ? result.prediction.class : 'Tidak Diketahui';
            const confidence = result.prediction ? result.prediction.confidence : 0;
            const paymentAmount = result.payment_amount;
            const ocrResult = result.ocr_result;

            const confidenceThreshold = 0.7;
            const isConfidentlyRecognizedPayment = confidence > confidenceThreshold && paymentAmount !== null;

            if (isConfidentlyRecognizedPayment) {
                // Balas pesan sukses langsung ke pesan gambar asli
                const nomorLokal = convertWaNumberToLocal(senderNumber)
               
                try{

                    await sendWebhookToLaravel(nomorLokal, paymentAmount, buffer, filename, media.mimetype);
    
                    await message.reply(`Baik kak, terima kasih, pembayaran telah kami terima 🙏 \n\n _* pesan ini dibalas oleh *ai harmony laundry*_`);
                    console.log(`[${new Date().toLocaleString()}] ✔️ Pembayaran valid dari ${senderNumber}. Pesan singkat dikirim ke pelanggan.`);
                }catch(error){
                    console.error(`[${new Date().toLocaleString()}] ❌ Gagal webhook Laravel untuk ${senderNumber.replace('@c.us', '')}, nominal: ${paymentAmount}. Error:`, error.message);
                    await message.reply(`Baik kak, terima kasih, pembayaran telah kami terima 🙏 \n\n _* pesan ini dibalas oleh *ai harmony laundry*_`);
                    
                    // if(predictedClass === "BUKAN_TF"){
                    //     console.log(`[${new Date().toLocaleString()}] - Prediction Class : ${predictedClass}`)
                    //     return
                    // }
                    // Kirim pesan ke admin sebagai fallback
                    await client.sendMessage(ADMIN_NUMBER, media, {
                        caption:
                            `🚨 *PERLU TINJAUAN MANUAL!* 🚨\n` +
                            `Pesan dari: ${senderNumber.replace('@c.us', '')}\n` +
                            `Prediksi Bot: *${predictedClass}* (Conf: ${(confidence * 100).toFixed(2)}%)\n` +
                            `Nominal Terdeteksi: *${paymentAmount ? `Rp ${paymentAmount.toLocaleString('id-ID')}` : 'Tidak Terdeteksi'}*\n` +
                            `Teks OCR Awal:\n${ocrResult.substring(0, 300)}${ocrResult.length > 300 ? '...' : ''}\n\n` +
                            `*Gagal menyimpan ke Laravel. Mohon periksa dan balas pelanggan secara manual.*`,
                        quotedMessageId: message.id?._serialized
                    });
                }
            } else {
                console.warn(`[${new Date().toLocaleString()}] ⚠️ Gambar dari ${senderNumber} TIDAK DIKENALI SECARA PASTI (atau bukan bukti pembayaran). Tidak membalas pelanggan secara otomatis.`);
                console.warn(`   Detail: Prediksi: ${predictedClass}, Confidence: ${confidence}, Nominal: ${paymentAmount}`);

                // Kirim notifikasi ke Admin, sebagai balasan ke gambar asli
                // Menggunakan message.id untuk mereferensikan pesan asli yang dikirim oleh pelanggan
                await client.sendMessage(ADMIN_NUMBER, media, {
                    caption:
                        `🚨 *PERLU TINJAUAN MANUAL!* 🚨\n` +
                        `Pesan dari: ${senderNumber.replace('@c.us', '')}\n` +
                        `Prediksi Bot: *${predictedClass}* (Conf: ${(confidence * 100).toFixed(2)}%)\n` +
                        `Nominal Terdeteksi: *${paymentAmount ? `Rp ${paymentAmount.toLocaleString('id-ID')}` : 'Tidak Terdeteksi'}*\n` +
                        `Teks OCR Awal:\n${ocrResult.substring(0, 300)}${ocrResult.length > 300 ? '...' : ''}\n\n` +
                        `*Gambar ini tidak dikenali secara pasti oleh AI atau bukan bukti pembayaran.* Mohon periksa dan balas pelanggan secara manual.`,
                    quotedMessageId: message.id?._serialized // <<< Ini akan membuat pesan admin me-reply ke pesan pelanggan
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
            // console.error(`[${new Date().toLocaleString()}] ❌ Error saat menambahkan pekerjaan ke antrean untuk ${senderNumber}:`, err.message)
            // await message.reply()
        }
    }
    // Tangani pesan teks lainnya yang bukan perintah
    else if (message.body && message.body.toLowerCase() === '!start') {
        await message.reply('Halo! Kirimkan gambar bukti pembayaran untuk saya deteksi. 😊');
    } else if (message.body && !message.isStatus) {
        try{
            console.log(`[${new Date().toLocaleString()}] simpan whatsapp ke laravel`)
            await saveMessageToLaravel(message)
        }catch(error){
            console.error(`[${new Date().toLocaleString()}] Gagal menyimpan ke laravel`, error.message)
        }
        console.log(`[${new Date().toLocaleString()}] Menerima pesan teks dari ${senderNumber}: "${message.body}". Tidak memproses otomatis.`);
    }
});


// --- Socket.IO Event Handlers (untuk komunikasi dengan antarmuka web jika ada) ---
io.on('connection', (socket) => {
    socket.emit('message', `${new Date().toLocaleString()} IO connected`);

    socket.on('disconnect-btn', (msg) => {
        console.log(`[${new Date().toLocaleString()}] Disconnect button clicked: ${msg}`);
        client.logout();
    });
});

// --- Rute Express untuk API Tambahan (jika ada) ---
app.post('/check-number', async (req, res) => {
    const phone = req.body.phone;
    try {
        let result = await client.isRegisteredUser(phone + '@c.us');
        res.status(200).json({
            error: false,
            data: {
                phone: phone,
                message: result ? "Nomor WhatsApp terdaftar." : "Nomor bukan WhatsApp.",
                isWa: result
            }
        });
    } catch (err) {
        console.error(`[${new Date().toLocaleString()}] Error checking number ${phone}:`, err);
        res.status(500).json({ error: true, message: "Terjadi kesalahan saat memeriksa nomor." });
    }
});

app.post('/send', async (req, res) => {
    try {
        const rawPhone = req.body.phone;
        const cleanedPhone = rawPhone.replace(/\D/g, '');
        const phone = cleanedPhone + "@c.us";
        const message = req.body.message;

        // Validasi format nomor yang lebih ketat jika perlu
        if (!/^\d{7,15}@c\.us$/.test(phone)) {
            return res.status(400).json({
                error: true,
                data: {
                    message: "Format nomor telepon tidak valid. Gunakan hanya angka dan pastikan kode negara yang benar.",
                    isWa: false,
                }
            });
        }

        const checkPhone = await client.isRegisteredUser(phone);

        if (checkPhone === false) {
            return res.status(200).json({
                error: true,
                data: {
                    message: "Nomor bukan WhatsApp",
                    isWa: false,
                }
            });
        }

        client.sendMessage(phone, message)
            .then(response => {
                req.app.io.emit('message-send', 'Pesan Berhasil Dikirim');
                res.status(200).json({
                    error: false,
                     data: {
                        message: 'Pesan terkirim',
                        // Hanya kirim properti yang pasti tersedia dan tidak akan menyebabkan error
                        // Misalnya, id yang diserialisasi (dengan optional chaining) jika benar-benar dibutuhkan
                        // Atau, cukup properti dasar seperti 'from', 'to', 'body'
                        meta: {
                            id: response.id?._serialized, // Akses dengan optional chaining
                            from: response.from,
                            to: response.to,
                            type: response.type,
                            body: response.body
                        }
                    }
                });
            })
            .catch(err => {
                console.error(`[${new Date().toLocaleString()}] Error sending message to ${phone}:`, err);
                res.status(200).json({
                    error: true,
                    data: {
                        message: "Error saat mengirim pesan",
                        meta: err.message
                    }
                });
            });
    } catch (catchErr) {
        console.error(`[${new Date().toLocaleString()}] Kesalahan tak terduga di rute /send:`, catchErr);
        if (catchErr.message && catchErr.message.includes('wid error: invalid wid')) {
             res.status(400).json({
                error: true,
                data: {
                    message: "Gagal mengirim pesan: Format nomor telepon tidak valid (invalid wid).",
                    meta: catchErr.message
                }
            });
        } else {
            res.status(500).json({
                error: true,
                data: {
                    message: "Terjadi kesalahan tak terduga",
                    meta: catchErr
                }
            });
        }
    }
});

// ... di dekat bagian atas main.js setelah app = express();
// app.post('/whatsapp_callback', async (req, res) => {
//     const { senderNumber, messageId, predictedClass, confidence, paymentAmount, ocrResult, status } = req.body;
//     console.log(`[${new Date().toLocaleString()}] Menerima callback dari worker Python untuk ${senderNumber}`);

//     const confidenceThreshold = 0.7;
//     const isConfidentlyRecognizedPayment = confidence > confidenceThreshold && paymentAmount !== null;

//     try {
//         // Dapatkan chat berdasarkan senderNumber (atau messageId jika lebih spesifik)
//         const chat = await client.getChatById(senderNumber);
//         if (!chat) {
//             console.error(`[${new Date().toLocaleString()}] Chat tidak ditemukan untuk ${senderNumber}`);
//             return res.status(404).json({ message: "Chat not found" });
//         }

//         if (status === 'success' && isConfidentlyRecognizedPayment) {
//             // Balas pesan sukses
//             await client.sendMessage(senderNumber, `Baik kak, terima kasih, pembayaran telah kami terima 🙏 \n\n_* pesan ini dibalas oleh *ai harmony laundry*_`, {
//                 quotedMessageId: messageId // Membalas pesan asli
//             });
//             console.log(`[${new Date().toLocaleString()}] ✔️ Pembayaran valid dari ${senderNumber}. Pesan singkat dikirim ke pelanggan.`);
//         } else {
//             console.warn(`[${new Date().toLocaleString()}] ⚠️ Gambar dari ${senderNumber} TIDAK DIKENALI SECARA PASTI (atau bukan bukti pembayaran).`);
//             console.warn(`   Detail: Prediksi: ${predictedClass}, Confidence: ${confidence}, Nominal: ${paymentAmount}`);

//             // Kirim notifikasi ke Admin
//             const mediaToSendToAdmin = await client.getMessageById(messageId).then(m => m.downloadMedia()).catch(() => null);

//             await client.sendMessage(ADMIN_NUMBER, mediaToSendToAdmin, {
//                 caption:
//                     `🚨 *PERLU TINJAUAN MANUAL!* 🚨\n` +
//                     `Pesan dari: ${senderNumber.replace('@c.us', '')}\n` +
//                     `Prediksi Bot: *${predictedClass}* (Conf: ${(confidence * 100).toFixed(2)}%)\n` +
//                     `Nominal Terdeteksi: *${paymentAmount ? `Rp ${paymentAmount.toLocaleString('id-ID')}` : 'Tidak Terdeteksi'}*\n` +
//                     `Teks OCR Awal:\n${ocrResult.substring(0, 300)}${ocrResult.length > 300 ? '...' : ''}\n\n` +
//                     `*Gambar ini tidak dikenali secara pasti oleh AI atau bukan bukti pembayaran.* Mohon periksa dan balas pelanggan secara manual.`,
//                 quotedMessageId: messageId // Ini akan membuat pesan admin me-reply ke pesan pelanggan
//             });
//             console.log(`[${new Date().toLocaleString()}] Notifikasi dikirim ke admin ${ADMIN_NUMBER}, mereply pesan asli.`);
//         }
//         res.status(200).json({ message: "Callback processed" });
//     } catch (error) {
//         console.error(`[${new Date().toLocaleString()}] Error processing WhatsApp callback:`, error);
//         res.status(500).json({ message: "Internal server error" });
//     }
// });

function convertWaNumberToLocal(waNumber) {
    if (waNumber.endsWith('@c.us')) {
        const raw = waNumber.replace('@c.us', '');
        if (raw.startsWith('62')) {
            return '0' + raw.substring(2);
        }
        return raw;
    }
    return waNumber;
}


const LARAVEL_BEARER_TOKEN = '195|H8oXpuf7jEyWqKJ9Tv9MZtneB3TtzB5vx6E1pwGh8be72488';

/**
 * Kirim data ke Laravel setelah OCR valid
 * @param {string} nomorLocal Format 08xxx
 * @param {number} nominal Nominal pembayaran
 * @param {Buffer} buffer Buffer gambar bukti transfer
 * @param {string} filename Nama file
 * @param {string} mimetype MIME gambar (image/jpeg, image/png, dll)
 */
async function sendWebhookToLaravel(nomorLocal, nominal, buffer, filename, mimetype) {
    const formData = new FormData();
        formData.append('sender_number', nomorLocal);
        formData.append('nominal', nominal);
        // formData.append('timestamp', Date.now());
        formData.append('timestamp', new Date().toISOString());
        formData.append('bukti', buffer, {
            filename: filename,
            contentType: mimetype
        });
    
    const headers = {
        ...formData.getHeaders(),
        Authorization: `Bearer ${LARAVEL_BEARER_TOKEN}`,
    }

    try {
        

        const response = await axios.post('https://api.harmonylaundry.my.id/pesanan-bayar-auto', formData, {
            headers:  headers,
            timeout: 15000
        });

        const log = [
            `[${new Date().toLocaleString()}] ✅ Webhook sukses ke Laravel`,
            `  ▶ Nomor   : ${nomorLocal}`,
            `  ▶ Nominal : ${nominal}`,
            `  ▶ Status  : ${response.status}`,
            `  ▶ Respon  : ${JSON.stringify(response.data)}`
        ].join('\n') + '\n\n';

        await fsPromises.appendFile(WEBHOOK_LOG_FILE, log);
        console.log(log.trim());

        return response.data;
    } catch (error) {
        let errorLog = `[${new Date().toLocaleString()}] ❌ Gagal webhook Laravel\n`;
        errorLog += `  ▶ Nomor   : ${nomorLocal}\n`;
        errorLog += `  ▶ Nominal : ${nominal}\n`;
        errorLog += `  ▶ Error   : ${error.message}\n`;

        if (error.response) {
            errorLog += `  ▶ Status  : ${error.response.status}\n`;
            errorLog += `  ▶ Body    : ${JSON.stringify(error.response.data)}\n`;
        } else if (error.request) {
            errorLog += `  ▶ Tidak ada respon dari server Laravel.\n`;
        } else {
            errorLog += `  ▶ Kesalahan: ${error.stack}\n`;
        }

        errorLog += `  ▶ Headers : ${JSON.stringify(headers)}\n`;
        errorLog += `  ▶ Fields  : sender_number=${nomorLocal}, nominal=${nominal}, timestamp=${new Date().toISOString()}, bukti=[buffer:${buffer.length}B, type=${mimetype}]\n\n`;

        await fsPromises.appendFile(WEBHOOK_LOG_FILE, errorLog);
        console.error(errorLog.trim());

        throw error;
    }
}

const saveMessageToLaravel = async (message,media=null,filename=null, mimetype=null) => {
    try{
        const formData = new FormData()
        formData.append('message_id', message.id?._serialized || "unkown_id")
        formData.append('from', message.from)
        formData.append('to', message.to || client.info.wid?._serialized ||"unknown_id")
        formData.append('message_type', message.type)
        formData.append('message_content', message.body || "")
        formData.append('from_customer', (!message.fromMe).toString())
        formData.append('is_group', (message.isGroupMsg || false).toString())
        formData.append('timestamp', new Date().toISOString())
        console.log(formData)
        if(media && filename && mimetype) {
            const buffer = Buffer.from(media.data, 'base64')
            formData.append('media', buffer, {
                filename,
                contentType: mimetype
            })
        }

        const res = await axios.post(`https://api.harmonylaundry.my.id/whatsapp/webhook`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization' : `Bearer ${LARAVEL_BEARER_TOKEN}`
            },
            timeout: 15000
        })

        console.log(res?.data)
        console.log(`[${new Date().toLocaleDateString()} ✅ pesan whatsapp berhasil disimpan ke laravel]`)
        await fsPromises.appendFile(CHAT_LOG_FILE, '✅ Pesan whatsapp berhasil disimpan ke laravel')
    }catch(error){
        console.log(`[${new Date().toLocaleDateString()} ❌ pesan whatsapp gagal disimpan ]`, error.response?.data || error.message)
        await fsPromises.appendFile(CHAT_LOG_FILE, `[${new Date().toLocaleString()}] - ❌ Pesan whatsapp gagal disimpan ke laravel  \n`)
    }
}

async function ensureDirectoryExists(dirPath){
    try{
        await fsPromises.mkdir(dirPath, {recursive:true})
        console.log(`[${new Date().toLocaleString()}] - Directory ${dirPath} created or already exists`)
    }catch(error){
        if(error.code !== 'EXISTS'){
            console.error(`[${new Date().toLocaleString()}] - Error creating directory ${dirPath}`, error.message)
            throw error
        }
    }
}

async function ensureFileExists(filePath){
    try{
        await fsPromises.appendFile(filePath, '')
    }catch(error){
        console.error(`[${new Date().toLocaleString()}] - Error ensuring file exists ${filePath}`, error)
        throw error
    }
}

// Mulai server Express/Socket.IO
server.listen(PORT, () => {
    console.log(`[${new Date().toLocaleString()}] - App berjalan di Port ${PORT}`);
});