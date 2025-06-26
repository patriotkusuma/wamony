// src/routes.js
module.exports = (app, client, io) => { // Menerima app, client, dan io sebagai parameter
    app.get('/', (req, res) => {
        res.sendFile('index.html', { root: __dirname + '/../public' }); // Path relatif ke public
    });

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
                }
            );
            }

            client.sendMessage(phone, message)
                .then(response => {
                    io.emit('message-send', 'Pesan Berhasil Dikirim');
                    res.status(200).json({
                        error: false,
                        data: {
                            message: 'Pesan terkirim',
                            meta: response
                        }
                    });
                })
                .catch(err => {
                    console.error(`[${new Date().toLocaleString()}] Error sending message to ${phone}:`, err);
                    res.status(200).json({
                        error: true,
                        data: {
                            message: "Error saat mengirim pesan",
                            meta: err
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

    app.post('/whatsapp_callback', async (req, res) => {
        const { senderNumber, messageId, predictedClass, confidence, paymentAmount, ocrResult, status } = req.body;
        console.log(`[${new Date().toLocaleString()}] Menerima callback dari worker Python untuk ${senderNumber}`);

        const confidenceThreshold = 0.7;
        const isConfidentlyRecognizedPayment = confidence > confidenceThreshold && paymentAmount !== null;

        try {
            const chat = await client.getChatById(senderNumber);
            if (!chat) {
                console.error(`[${new Date().toLocaleString()}] Chat tidak ditemukan untuk ${senderNumber}`);
                return res.status(404).json({ message: "Chat not found" });
            }

            if (status === 'success' && isConfidentlyRecognizedPayment) {
                await client.sendMessage(senderNumber, `Baik kak, terima kasih, pembayaran telah kami terima 🙏 \n\n_* pesan ini dibalas oleh *ai harmony laundry*_`, {
                    quotedMessageId: messageId
                });
                console.log(`[${new Date().toLocaleString()}] ✔️ Pembayaran valid dari ${senderNumber}. Pesan singkat dikirim ke pelanggan.`);
            } else {
                console.warn(`[${new Date().toLocaleString()}] ⚠️ Gambar dari ${senderNumber} TIDAK DIKENALI SECARA PASTI (atau bukan bukti pembayaran).`);
                console.warn(`   Detail: Prediksi: ${predictedClass}, Confidence: ${confidence}, Nominal: ${paymentAmount}`);

                const mediaToSendToAdmin = await client.getMessageById(messageId).then(m => m.downloadMedia()).catch(() => null);

                await client.sendMessage(ADMIN_NUMBER, mediaToSendToAdmin, {
                    caption:
                        `🚨 *PERLU TINJAUAN MANUAL!* 🚨\n` +
                        `Pesan dari: ${senderNumber.replace('@c.us', '')}\n` +
                        `Prediksi Bot: *${predictedClass}* (Conf: ${(confidence * 100).toFixed(2)}%)\n` +
                        `Nominal Terdeteksi: *${paymentAmount ? `Rp ${paymentAmount.toLocaleString('id-ID')}` : 'Tidak Terdeteksi'}*\n` +
                        `Teks OCR Awal:\n${ocrResult.substring(0, 300)}${ocrResult.length > 300 ? '...' : ''}\n\n` +
                        `*Gambar ini tidak dikenali secara pasti oleh AI atau bukan bukti pembayaran.* Mohon periksa dan balas pelanggan secara manual.`,
                    quotedMessageId: messageId
                });
                console.log(`[${new Date().toLocaleString()}] Notifikasi dikirim ke admin ${ADMIN_NUMBER}, mereply pesan asli.`);
            }
            res.status(200).json({ message: "Callback processed" });
        } catch (error) {
            console.error(`[${new Date().toLocaleString()}] Error processing WhatsApp callback:`, error);
            res.status(500).json({ message: "Internal server error" });
        }
    });
};