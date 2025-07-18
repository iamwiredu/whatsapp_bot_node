const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const client = new Client();

client.on('qr', qr => {
  console.log('Scan the QR below with your WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');
});

client.on('message', async message => {
  console.log(`📩 Received message: ${message.body} from ${message.from}`);

  // Example: Forward to your Django backend
  try {
    await axios.post('http://localhost:8000/api/webhook/', {
      number: message.from,
      message: message.body
    });
  } catch (err) {
    console.error('❌ Failed to send to Django:', err.message);
  }
});

// API endpoint to send messages from Django
app.post('/send-message', async (req, res) => {
  const { number, message } = req.body;
  try {
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
    res.send({ status: 'sent' });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

client.initialize();

// Start Express server
app.listen(3000, () => {
  console.log('🚀 Express server running on http://localhost:3000');
});
