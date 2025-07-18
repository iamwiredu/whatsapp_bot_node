const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true }
});

// Menu with prices in GHS
const MENU = {
  pizza: 25,
  burger: 15,
  fries: 10
};

// In-memory sessions
const sessions = new Map();

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');
});

client.on('message', async msg => {
  const phone = msg.from.split('@')[0];  // Strip WhatsApp suffix
  const message = msg.body.trim().toLowerCase();

  // Set up session
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      current_step: 'start',
      temp_order_data: {}
    });
  }

  const session = sessions.get(phone);

  // Start order
  if (message === 'hi') {
    const menuText = "🍔 *Menu*\n" + Object.entries(MENU)
      .map(([item, price]) => `- ${item.charAt(0).toUpperCase() + item.slice(1)} (GH₵${price})`)
      .join('\n');

    await client.sendMessage(phone + '@c.us', `Hi! 👋 Welcome to Grab Text.\n\n${menuText}\n\nPlease type the *name* of the item you'd like to order.`);
    session.current_step = 'awaiting_item';
    session.temp_order_data = {};
    return;
  }

  // Conversation flow
  switch (session.current_step) {
    case 'awaiting_item':
      if (MENU[message]) {
        session.temp_order_data.item = message;
        session.current_step = 'awaiting_quantity';
        await client.sendMessage(phone + '@c.us', `Great! 🍽 How many *${message}s* would you like?`);
      } else {
        await client.sendMessage(phone + '@c.us', "❌ We don't have that. Choose: pizza, burger, or fries.");
      }
      break;

    case 'awaiting_quantity':
      if (/^\d+$/.test(message)) {
        session.temp_order_data.quantity = parseInt(message);
        session.current_step = 'awaiting_address';
        await client.sendMessage(phone + '@c.us', "📍 Please enter your *delivery address*.");
      } else {
        await client.sendMessage(phone + '@c.us', "❌ Please enter a valid number.");
      }
      break;

    case 'awaiting_address':
      try {
        const item = session.temp_order_data.item;
        const quantity = session.temp_order_data.quantity;
        const address = msg.body;

        const unitPrice = MENU[item];
        const amountGHS = unitPrice * quantity;
        const amountPesewas = amountGHS;

        // 📨 Let the user know their order is being processed
        await client.sendMessage(phone+ '@c.us', "⏳ Processing your order...");

        // 🔗 Send order to Django API
        const response = await axios.post('https://07229c36e080.ngrok-free.app/create-order/', {
          phone_number: phone,
          item,
          quantity,
          address,
          amount: amountPesewas
        });

        if (response.data.success) {
          const paymentLink = response.data.order_url;

          await client.sendMessage(
            phone + '@c.us',
            `✅ Order received!\n🛒 ${quantity} x ${item.charAt(0).toUpperCase() + item.slice(1)}\n📍 ${address}\n\n💳 Please pay here:\n${paymentLink}`
          );
        } else {
          await client.sendMessage(phone + '@c.us', "⚠️ Something went wrong. Could not create order.");
        }

        session.temp_order_data = {};
        session.current_step = 'start';
      } catch (err) {
        console.error("❌ Error creating order:", err.response?.data || err.message);
        await client.sendMessage(phone + '@c.us', "⚠️ Error processing your order. Please type *hi* to try again.");
        session.temp_order_data = {};
        session.current_step = 'start';
      }
      break;

    default:
      await client.sendMessage(phone + '@c.us', "👋 Hi! To start a new order, just type *hi*.");
      session.current_step = 'start';
  }

  sessions.set(phone, session);
});

client.initialize();
