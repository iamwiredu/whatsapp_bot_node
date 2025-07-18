const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true }
});

const MENU = {
  pizza: 25,
  burger: 15,
  fries: 10
};

const sessions = new Map();

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');
});

client.on('message', msg => {
  const phone = msg.from.split('@')[0];
  const message = msg.body.trim().toLowerCase();

  if (!sessions.has(phone)) {
    sessions.set(phone, {
      current_step: 'start',
      temp_order_data: {}
    });
  }

  const session = sessions.get(phone);

  if (message === 'hi') {
    const menuText = "🍔 *Menu*\n" + Object.entries(MENU)
      .map(([item, price]) => `- ${item.charAt(0).toUpperCase() + item.slice(1)} (GH₵${price})`)
      .join('\n');

    client.sendMessage(msg.from, `Hi! 👋 Welcome to Grab Text.\n\n${menuText}\n\nPlease type the *name* of the item you'd like to order.`)
      .catch(console.error);

    session.current_step = 'awaiting_item';
    session.temp_order_data = {};
    return;
  }

  switch (session.current_step) {
    case 'awaiting_item':
      if (MENU[message]) {
        session.temp_order_data.item = message;
        session.current_step = 'awaiting_quantity';
        client.sendMessage(msg.from, `Great! 🍽 How many *${message}s* would you like?`).catch(console.error);
      } else {
        client.sendMessage(msg.from, "❌ We don't have that. Choose: pizza, burger, or fries.").catch(console.error);
      }
      break;

    case 'awaiting_quantity':
      if (/^\d+$/.test(message)) {
        session.temp_order_data.quantity = parseInt(message);
        session.current_step = 'awaiting_address';
        client.sendMessage(msg.from, "📍 Please enter your *delivery address*.").catch(console.error);
      } else {
        client.sendMessage(msg.from, "❌ Please enter a valid number.").catch(console.error);
      }
      break;

    case 'awaiting_address':
      const item = session.temp_order_data.item;
      const quantity = session.temp_order_data.quantity;
      const address = msg.body;
      const unitPrice = MENU[item];
      const amountPesewas = unitPrice * quantity;

      client.sendMessage(msg.from, "⏳ Processing your order...").catch(console.error);

      axios.post('https://grabtexts.shop/create-order/', {
        phone_number: phone,
        item,
        quantity,
        address,
        amount: amountPesewas
      }).then(response => {
        if (response.data.success) {
          const paymentLink = response.data.order_url;
          client.sendMessage(msg.from, `✅ Order received!\n🛒 ${quantity} x ${item}\n📍 ${address}\n\n💳 Pay here:\n${paymentLink}`).catch(console.error);
        } else {
          client.sendMessage(msg.from, "⚠️ Something went wrong. Could not create order.").catch(console.error);
        }
        session.temp_order_data = {};
        session.current_step = 'start';
      }).catch(error => {
        console.error("❌ Error creating order:", error.response?.data || error.message);
        client.sendMessage(msg.from, "⚠️ Error processing your order. Please type *hi* to try again.").catch(console.error);
        session.temp_order_data = {};
        session.current_step = 'start';
      });
      break;

    default:
      client.sendMessage(msg.from, "👋 Hi! To start a new order, just type *hi*.").catch(console.error);
      session.current_step = 'start';
  }

  sessions.set(phone, session);
});

client.initialize();

// ------------------- Express server to keep app alive -------------------
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 WhatsApp bot is running');
});

app.listen(PORT, () => {
  console.log(`🌍 Express server running on port ${PORT}`);
});
