const express = require('express')
const http = require('http')
const socketIO = require('socket.io')
const path = require('path')

const app = express()
const server = http.createServer(app)
const io = socketIO(server, {
    cors: {
        origin: (_req, callback) => {
            callback(null, true)
        },
        credentials: true
    }
})

app.use(express.json())
app.use(express.urlencoded({extended:true}))
app.use(express.static(path.join(__dirname, ".../public")))

module.exports = {app, server, io}