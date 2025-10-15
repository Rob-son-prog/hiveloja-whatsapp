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
app.get('/send-test', async (req, res) => {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const toRaw = req.query.to || process.env.TEST_TO || '';
    const to = (toRaw || '').replace(/\D/g, ''); // só dígitos, formato E.164

    if (!to) {
      return res.status(400).json({ error: 'Informe ?to=5565... ou defina TEST_TO no .env' });
    }

    const result = await sendText({
      token,
      phoneNumberId,
      to,
      body: 'Teste ok ✅'
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[SEND-TEST] erro:', err);
    return res.status(500).json({ error: 'Falha ao enviar mensagem' });
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Servidor WhatsApp rodando na porta ${PORT}`);
});
