// index.js
require('dotenv').config();
const express = require('express');
const { sendText } = require('./phone');

const app = express();
app.use(express.json());

// logs de boot
console.log('[BOOT] TOKEN prefix:', (process.env.WHATSAPP_TOKEN || '').slice(0, 3));
console.log('[BOOT] PHONE_NUMBER_ID:', process.env.PHONE_NUMBER_ID);
console.log('[BOOT] TEST_TO:', process.env.TEST_TO);

// rota de saúde
app.get('/', (req, res) => res.send('ok'));

// rota simples p/ checar
app.get('/send-ok', (req, res) => res.send('send-ok'));

// webhook (GET) — validação do desafio
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || '').trim();
  const mode = (req.query['hub.mode'] || '').trim();
  const token = (req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'] || '';
  console.log('[WEBHOOK VERIFY] mode=', mode, ' token=', token, ' expected=', VERIFY_TOKEN, ' challenge=', challenge);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// webhook (POST) — eventos
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('[WEBHOOK] body:', JSON.stringify(body, null, 2));

    // Confere estrutura do WABA
    if (body.object === 'whatsapp_business_account' &&
        Array.isArray(body.entry) &&
        body.entry[0]?.changes?.[0]?.value?.messages?.length) {

      const value = body.entry[0].changes[0].value;
      const msg = value.messages[0];

      // só responde mensagens de texto recebidas
      if (msg.type === 'text' && msg.from) {
        const to = `+${msg.from}`; // vem sem o "+"
        const bodyText = msg.text?.body || '';

        // evita responder a mensagens que você mesmo enviou (status msgs não têm from de cliente)
        if (!msg.id?.startsWith('wamid.')) {
          console.log('[WEBHOOK] ignorando evento sem wamid');
        }

        // responde
        await sendText({
          token: process.env.WHATSAPP_TOKEN,
          phoneNumberId: process.env.PHONE_NUMBER_ID,
          to,
          body: `Recebi: "${bodyText}" ✅`
        });
      }
    }

    return res.sendStatus(200); // sempre responde 200 rápido
  } catch (e) {
    console.error('Erro no webhook:', e);
    return res.sendStatus(200);
  }
});


// rota de teste de envio
app.get('/send-test', async (req, res) => {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const to = (req.query.to || process.env.TEST_TO || '').replace(/\D/g, '');
    if (!to) return res.status(400).json({ ok: false, error: 'Informe ?to=+55XXXXXXXXX ou defina TEST_TO no .env' });

    const result = await sendText({
      token,
      phoneNumberId,
      to: `+${to}`,
      body: 'Teste ok ✅'
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[SEND-TEST] erro:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao enviar' });
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Servidor WhatsApp rodando na porta ${PORT}`));
