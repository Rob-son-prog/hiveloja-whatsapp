// phone.js — helpers para conversar com a Cloud API
const fetch = require('node-fetch');

async function sendText({ token, phoneNumberId, to, body }) {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    })
  });

  const data = await resp.json();
  return { ok: resp.ok, status: resp.status, data };
}

module.exports = { sendText };
