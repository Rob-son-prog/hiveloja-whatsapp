// index.js — servidor mínimo
require('dotenv').config();
const express = require('express');
const { sendText } = require('./phone');

const app = express();
app.use(express.json());

// logs rapidinhos pra conferir se o .env foi lido
console.log('[BOOT] TOKEN prefix:', (process.env.WHATSAPP_TOKEN || '').slice(0, 3)); // deve ser 'EAA'
console.log('[BOOT] PHONE_NUMBER_ID:', process.env.PHONE_NUMBER_ID);
console.log('[BOOT] TEST_TO:', process.env.TEST_TO);

// rota de saúde
app.get('/', (req, res) => res.send('ok'));

// webhook (VERIFICATION GET)
app.get('/webhook', (req, res) => {
  const verifyToken = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// webhook (RECEIVE POST)
app.post('/webhook', (req, res) => {
  // só loga o que chegou — depois você trata
  console.log('[WEBHOOK] body:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// rota de teste — usa ?to=5565... ou cai no TEST_TO do .env
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || '').trim();

  const mode = (req.query['hub.mode'] || '').trim();
  const token = (req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'] || '';

  console.log('[WEBHOOK VERIFY] mode=', mode, ' token=', token, ' expected=', VERIFY_TOKEN, ' challenge=', challenge);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  console.warn('[WEBHOOK VERIFY] mismatch -> 403');
  return res.sendStatus(403);
});


const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Servidor WhatsApp rodando na porta ${PORT}`);
});
