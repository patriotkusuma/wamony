require('dotenv').config()

module.exports = {
    SESSION_FILE_PATH: process.env.SESSION_FILE_PATH || './wtf-session.json',
    PORT: process.env.PORT || 8000,
    FASTAPI_URL: process.env.FASTAPI_URL || "https://ai.harmonylaundry.my.id/predict_receipt/",
    ADMIN_NUMBER: process.env.ADMIN_NUMBER || '6281223008363@c.us'
}