// phone.js — usando fetch nativo (Node 18+)

async function sendText({ token, phoneNumberId, to, body }) {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

/**
 * Envia mensagem interativa com botões (máx. 3).
 * buttons: [{ id:'CHOOSE_A', title:'Produto A' }, { id:'CHOOSE_B', title:'Produto B' }, { id:'MENU', title:'Menu' }]
 */
async function sendButtons({ token, phoneNumberId, to, body, buttons }) {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

module.exports = { sendText, sendButtons };

const axios = require('axios');

/**
 * Envia um DOCUMENT (PDF, etc) por link público
 */
async function sendDocument({ token, phoneNumberId, to, url, filename }) {
  const resp = await axios.post(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: {
        link: url,                 // deve ser público
        filename: filename || undefined
      }
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return resp.data;
}

/**
 * Envia um VÍDEO por link público (mp4/mov). Para YouTube/Vimeo, mande como texto com link.
 */
async function sendVideo({ token, phoneNumberId, to, url, caption }) {
  const resp = await axios.post(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'video',
      video: {
        link: url,                 // deve ser público
        caption: caption || undefined
      }
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return resp.data;
}
