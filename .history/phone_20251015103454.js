// phone.js
const axios = require('axios');

/**
 * Cria um cliente axios para a WhatsApp Cloud API
 */
function waClient({ token, phoneNumberId }) {
  if (!token) throw new Error('WHATSAPP_TOKEN ausente');
  if (!phoneNumberId) throw new Error('PHONE_NUMBER_ID ausente');

  // mantenho a mesma versão que você já usa no projeto
  const baseURL = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });
}

/** Envia texto simples */
async function sendText({ token, phoneNumberId, to, body, previewUrl = false }) {
  const api = waClient({ token, phoneNumberId });
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: String(body || '').slice(0, 4096), preview_url: !!previewUrl },
  };
  const { data } = await api.post('', payload);
  return data;
}

/**
 * Envia botões (interactive button)
 * buttons: [{ id: 'CHOOSE_A', title: 'Produto A' }, ...]
 */
async function sendButtons({ token, phoneNumberId, to, body, buttons = [] }) {
  const api = waClient({ token, phoneNumberId });
  const btns = (buttons || [])
    .slice(0, 3)
    .map((b) => ({
      type: 'reply',
      reply: {
        id: String(b.id || '').slice(0, 256),
        title: String(b.title || '').slice(0, 20),
      },
    }));

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(body || '').slice(0, 1024) },
      action: { buttons: btns },
    },
  };

  const { data } = await api.post('', payload);
  return data;
}

/** Envia documento por URL (PDF, etc.) */
async function sendDocument({ token, phoneNumberId, to, url, filename }) {
  if (!url) throw new Error('sendDocument: url é obrigatório');
  const api = waClient({ token, phoneNumberId });
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: {
      link: url,
      filename: filename || 'arquivo.pdf',
    },
  };
  const { data } = await api.post('', payload);
  return data;
}

/** Envia vídeo por URL (MP4 hospedado) com legenda opcional */
async function sendVideo({ token, phoneNumberId, to, url, caption }) {
  if (!url) throw new Error('sendVideo: url é obrigatório');
  const api = waClient({ token, phoneNumberId });
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'video',
    video: {
      link: url,
      caption: caption ? String(caption).slice(0, 1024) : undefined,
    },
  };
  const { data } = await api.post('', payload);
  return data;
}

/** Envia imagem por URL (JPG/PNG/WEBP/GIF) com legenda opcional */
async function sendImage({ token, phoneNumberId, to, url, caption }) {
  if (!url) throw new Error('sendImage: url é obrigatório');
  const api = waClient({ token, phoneNumberId });
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: {
      link: url,
      caption: caption ? String(caption).slice(0, 1024) : undefined,
    },
  };
  const { data } = await api.post('', payload);
  return data;
}

module.exports = {
  sendText,
  sendButtons,
  sendDocument,
  sendVideo,
  sendImage, // <— novo
};
