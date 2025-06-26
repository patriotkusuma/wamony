const {Client, LocalAuth} = require("whatsapp-web.js")
const {SESSION_FILE_PATH} = require('./config')
const fs = require('fs')

let sessionCfg
if(fs.existsSync(SESSION_FILE_PATH)){
    sessionCfg = require(SESSION_FILE_PATH)
}

const client = new Client({
    authStrategy:  new LocalAuth({
        clientId: 'harmony-notif'
    }), 
    puppeteer: {
        headless:true,
        args: [
            '--no-sandbox',
            '--disable-gpu',
            '--disable-setuid-sandbox',
        ]
    },
    webVersionCache: {
        type: "local",
    }
})


module.exports = client;