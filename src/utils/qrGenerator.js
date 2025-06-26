const qrcode = require('qrcode')

const generateQrCodeUrl = (qrData) => {
    return new Promise((resolve, reject) => {
        qrcode.toDataURL(qrData, (err, url ) => {
            if(err) {
                return reject(err)
            }
            resolve(url)
        })
    })
}

module.exports = {generateQrCodeUrl}