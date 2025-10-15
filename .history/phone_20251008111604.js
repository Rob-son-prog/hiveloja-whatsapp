// phone.js — helpers para conversar com a Cloud API
const axios = require('axios');

async function sendText({ token, phoneNumberId, to, body }) {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const resp = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return resp.data;
}

/**
 * Envia mensagem interativa com botões (máx. 3).
 * buttons: [{ id:'CHOOSE_A', title:'Produto A' }, { id:'CHOOSE_B', title:'Produto B' }, ...]
 */
async function sendButtons({ token, phoneNumberId, to, body, buttons }) {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const interactive = {
    type: 'button',
    body: { text: body },
    action: {
      buttons: buttons.map(b => ({
        type: 'reply',
        reply: { id: b.id, title: b.title }
      }))
    }
  };

  const resp = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return resp.data;
}

module.exports = { sendText, sendButtons };
