const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true }
});

const sessions = new Map();

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');

  const app = express();
  const PORT = process.env.PORT || 3000;
  app.use(express.json());

  app.get('/', (req, res) => {
    res.send('🤖 WhatsApp bot is running and connected ✅');
  });

  app.post('/send-payment-confirmation', (req, res) => {
    const { phone, slug, order_id } = req.body;

    if (!phone || !slug) {
      return res.status(400).json({ success: false, error: 'Missing phone or slug' });
    }

    const trackingUrl = `https://wa.me/+233559665774`;
    const message = `✅ Payment received for your order #${order_id}!\nWe will give you a call in a sec.\nContact support at ${trackingUrl}`;
    const fullNumber = `${phone}@c.us`;

    client.sendMessage(fullNumber, message)
      .then(() => res.json({ success: true }))
      .catch(err => {
        console.error('❌ Error sending WhatsApp message:', err);
        res.status(500).json({ success: false, error: 'Failed to send message' });
      });
  });

  app.post('/start-address-flow', (req, res) => {
    const { phone, slug, item, quantity, amount, addons } = req.body;

    if (!phone || !slug) {
      return res.status(400).json({ success: false, error: 'Missing phone or slug' });
    }

    const fullNumber = `${phone}@c.us`;
    const addonList = (addons || []).map(a => a.name).join(', ');
    const message =
      `🧾 Order Summary:\n${quantity} x ${item}\n` +
      (addonList ? `➕ Add-ons: ${addonList}\n` : '') +
      `\n\n📍 Please type your *delivery address* to continue.`;

    if (!sessions.has(phone)) {
      sessions.set(phone, {
        current_step: 'awaiting_address',
        temp_order_data: {
          item,
          quantity,
          unit_price: amount,
          selected_addons: addons,
          restaurant_code: slug
        }
      });
    } else {
      const session = sessions.get(phone);
      session.current_step = 'awaiting_address';
      session.temp_order_data = {
        item,
        quantity,
        unit_price: amount,
        selected_addons: addons,
        restaurant_code: slug
      };
      sessions.set(phone, session);
    }

    client.sendMessage(fullNumber, message)
      .then(() => res.json({ success: true }))
      .catch(err => {
        console.error('❌ Error sending WhatsApp address message:', err);
        res.status(500).json({ success: false, error: 'Failed to send address request' });
      });
  });

  app.listen(PORT, () => {
    console.log(`🌍 Express server running on port ${PORT}`);
  });
});

client.on('message', async (msg) => {
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
    client.sendMessage(msg.from,
      `👋 Welcome to *GrabTexts*!\n\n🍽️ To get started, type the code of your restaurant or service (e.g. *kbarb*, *sizzlers*)`)
      .catch(console.error);

    session.current_step = 'awaiting_restaurant_code';
    session.temp_order_data = {};
    return;
  }

  switch (session.current_step) {
    case 'awaiting_restaurant_code':
      try {
        const response = await axios.get(`https://grabtexts.shop/api/menu/${message}/`);
        const { restaurant, menu } = response.data;

        if (!menu || menu.length === 0) {
          client.sendMessage(msg.from, `😕 No menu items found for *${restaurant}*.`).catch(console.error);
          return;
        }

        session.temp_order_data.restaurant_code = message;
        session.temp_order_data.menu = menu;
        session.temp_order_data.restaurant_name = restaurant;

        client.sendMessage(msg.from,
          `🍽️ *${restaurant}* found!\nHow would you like to continue?\n\n` +
          `1. View menu here in WhatsApp\n2. Open full catalog (recommended)\n\nType *1* or *2* to choose.`)
          .catch(console.error);

        session.current_step = 'menu_view_choice';
      } catch (error) {
        client.sendMessage(msg.from, `❌ Invalid restaurant code or fetch error.`).catch(console.error);
        session.current_step = 'start';
      }
      break;

    case 'menu_view_choice':
      if (message === '1') {
        const menu = session.temp_order_data.menu;
        const restaurant = session.temp_order_data.restaurant_name;

        const menuText = `🍽️ *Menu from ${restaurant}*\n` + menu.map((item, i) => {
          const line = `${i + 1}. ${item.name} - GH₵${item.price}`;
          const addons = item.addons.map(a => `+ ${a.name} (GH₵${a.price / 100})`).join(', ');
          return addons ? `${line}\n    Add-ons: ${addons}` : line;
        }).join('\n');

        client.sendMessage(msg.from, `${menuText}\n\nReply with the *number* of the item you want to order.`).catch(console.error);
        session.current_step = 'awaiting_item';
      } else if (message === '2') {
        const code = session.temp_order_data.restaurant_code;
        client.sendMessage(msg.from,
          `🧾 Tap to browse and order from catalog:\n👉 https://grabtexts.shop/${code}-menu/?phone=${phone}`)
          .catch(console.error);
        session.current_step = 'wait_for_catalog_submission';
      } else {
        client.sendMessage(msg.from, `❌ Please type *1* or *2* to continue.`).catch(console.error);
      }
      break;

    case 'awaiting_item':
      const index = parseInt(message) - 1;
      const menu = session.temp_order_data.menu;

      if (!isNaN(index) && menu && menu[index]) {
        const selected = menu[index];
        session.temp_order_data.item = selected.name;
        session.temp_order_data.unit_price = selected.price;
        session.temp_order_data.quantity = 1;
        session.temp_order_data.addons = selected.addons || [];
        session.current_step = selected.addons.length > 0 ? 'awaiting_addon' : 'awaiting_address';

        if (selected.addons.length > 0) {
          const addonOptions = selected.addons.map((addon, i) => `${i + 1}. ${addon.name} (+GH₵${addon.price / 100})`).join('\n');
          client.sendMessage(msg.from, `➕ Select *add-ons* by typing the numbers separated by comma (or type 0 to skip):\n${addonOptions}`).catch(console.error);
        } else {
          client.sendMessage(msg.from, `📍 Please enter your *delivery address*.`).catch(console.error);
        }
      } else {
        client.sendMessage(msg.from, `❌ Invalid selection. Reply with a valid number.`).catch(console.error);
      }
      break;

    case 'awaiting_addon':
      const addonIndices = message.split(',').map(m => parseInt(m.trim()) - 1);
      const availableAddons = session.temp_order_data.addons;
      const selectedAddons = [];

      if (!(addonIndices.length === 1 && addonIndices[0] === -1)) {
        addonIndices.forEach(i => {
          if (!isNaN(i) && availableAddons[i]) {
            selectedAddons.push(availableAddons[i]);
          }
        });
      }

      session.temp_order_data.selected_addons = selectedAddons;
      session.current_step = 'awaiting_address';
      client.sendMessage(msg.from, `📍 Please enter your *delivery address*.`).catch(console.error);
      break;

    case 'awaiting_address':
      const { item, quantity, unit_price, selected_addons = [], restaurant_code } = session.temp_order_data;
      const address = msg.body;
      let addonsCost = 0;

      const addonsFormatted = selected_addons.map(addon => {
        addonsCost += addon.price;
        return { name: addon.name, price: addon.price };
      });

      const amountPesewas = (unit_price * quantity) + addonsCost;

      client.sendMessage(msg.from, "⏳ Processing your order...").catch(console.error);

      axios.post('https://grabtexts.shop/create-order/', {
        phone_number: phone,
        item,
        quantity,
        address,
        amount: amountPesewas,
        restaurant_code,
        addons: addonsFormatted
      }).then(response => {
        if (response.data.success) {
          const paymentLink = response.data.order_url;
          client.sendMessage(msg.from,
            `✅ Order received!\n🧾 ${quantity} x ${item}\n📍 ${address}` +
            (addonsFormatted.length > 0 ? `\n➕ Add-ons: ${addonsFormatted.map(a => a.name).join(', ')}` : '') +
            `\n\n💳 Pay here:\n${paymentLink}`
          ).catch(console.error);
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
      client.sendMessage(msg.from, "👋 Hi! To begin, type *hi*.").catch(console.error);
      session.current_step = 'start';
  }

  sessions.set(phone, session);
});

client.initialize();
