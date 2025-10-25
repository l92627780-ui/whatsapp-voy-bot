const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@adiwajshing/baileys");
const express = require("express");
const qrcode = require("qrcode");
const { Low, JSONFile } = require("lowdb");
const fs = require("fs");

// 📌 Base de datos local (db.json)
const adapter = new JSONFile("db.json");
const db = new Low(adapter);

// 📌 Cargar archivo db.json
async function loadDB() {
  await db.read();
  db.data ||= { botActive: true, boton1Groups: [] };
  await db.write();
}

// 📌 Servidor Express para QR y botones
const app = express();
app.use(express.json());

let sock; // conexión de WhatsApp

// ✅ Endpoint para ver el QR en el navegador
app.get("/qr", async (req, res) => {
  if (!global.qr) return res.send("⏳ Esperando QR...");
  const qrImage = await qrcode.toDataURL(global.qr);
  res.send(`<img src="${qrImage}" style="width:250px;height:250px">`);
});

// ✅ Botón para activar/desactivar bot
app.post("/boton1/:state", async (req, res) => {
  const state = req.params.state === "on";
  db.data.botActive = state;
  await db.write();
  res.send(`✅ Botón 1 ahora está: ${state ? "ENCENDIDO" : "APAGADO"}`);
});

// ✅ Iniciar WhatsApp
async function startSock() {
  await loadDB();
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state
  });

  // QR para iniciar sesión
  sock.ev.on("connection.update", (update) => {
    const { qr, connection, lastDisconnect } = update;
    if (qr) {
      global.qr = qr;
      console.log("📲 Escanea el QR para conectar WhatsApp");
    }
    if (connection === "close") {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        startSock();
      } else {
        console.log("❌ Sesión cerrada. Borra la carpeta session y reinicia.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // 📩 Cuando llega un mensaje...
  sock.ev.on("messages.upsert", async (m) => {
    if (!db.data.botActive) return; // si el bot está apagado

    const msg = m.messages[0];
    if (!msg.message || msg.key.remoteJid === "status@broadcast") return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const chatId = msg.key.remoteJid;

    // Solo responder si el mensaje tiene foto
    const hasImage = !!m
