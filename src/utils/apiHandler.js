const axios = require('axios')
const FormData = require('form-data')
const {FASTAPI_URL} = require('../config')

const sendImageToFastApi = async (buffer, mimetype, senderNumber) => {
    const formData = new FormData()
    formData.append('file', buffer, {
        filename: 'image.jp',
        contentType: mimetype
    })

    formData.append('sender_number', senderNumber)

    console.log(`[${new Date().toLocaleString()}] Mengirim gambar ke FastAPI dari ${senderNumber} ...`)

    const response = await axios.post(FASTAPI_URL,  formData, {
        headers: {
            ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000
    })

    return response.data
}

module.exports = {sendImageToFastApi}