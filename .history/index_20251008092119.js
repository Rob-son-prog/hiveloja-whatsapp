// index.js
require('dotenv').config();
const express = require('express');
const { sendText } = require('./phone');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// --- CONFIG persistente (config.json) ---
const CONFIG_PATH = path.join(__dirname, 'config.json');
let CONFIG = {
  titulo: "Lista de Fornecedores de Atacado",
  texto: "Receba a lista completa imediatamente após o pagamento.",
  preco: "R$ 19,90",
  whatsapp_suporte: "+5565984361007",
  checkout_url: "https://pay.cakto.com.br/SEU_LINK?orderId={ORDER_ID}"
};

// --- helpers do fluxo de venda ---
const sessions = new Map(); // memória simples p/ acompanhar o pedido

function makeOrderId() {
  return 'ORD-' + Date.now().toString(36).toUpperCase().slice(-6);
}

function buildCheckoutUrl(orderId) {
  return String(CONFIG.checkout_url || '').replace('{ORDER_ID}', orderId);
}

// carrega se existir
try {
  if (fs.existsSync(CONFIG_PATH)) {
    CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
} catch (e) {
  console.error('Falha ao ler config.json:', e);
}

// salva no disco
function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG, null, 2));
}

// --- rotas da config ---
app.get('/config', (_req, res) => res.json(CONFIG));

app.post('/config', (req, res) => {
  const { titulo, texto, preco, whatsapp_suporte, checkout_url } = req.body || {};
  Object.assign(CONFIG, {
    ...(titulo !== undefined ? { titulo } : {}),
    ...(texto !== undefined ? { texto } : {}),
    ...(preco !== undefined ? { preco } : {}),
    ...(whatsapp_suporte !== undefined ? { whatsapp_suporte } : {}),
    ...(checkout_url !== undefined ? { checkout_url } : {}),
  });
  saveConfig();
  return res.json({ ok: true, CONFIG });
});

// servir o painel estático
app.use('/admin', express.static(path.join(__dirname, 'admin')));

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
app.post('/webhook', (req, res) => {
  // 1) responde 200 imediatamente
  res.sendStatus(200);

  // 2) processa de forma assíncrona
  (async () => {
    try {
      const body = req.body;

      // LOG bruto (útil p/ depuração)
      // console.log('[RAW]', JSON.stringify(body));

      // valida estrutura: só seguimos se houver messages[]
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const msg   = value?.messages?.[0];
      if (!value || !msg) {
        // console.log('[SKIP] sem messages (provável status)');
        return;
      }

      if (!msg.from) return;

      // ignora eco do próprio WABA
      const myWaba = value?.metadata?.phone_number_id;
      if (String(msg.from) === String(myWaba)) {
        // console.log('[SKIP] eco do próprio WABA');
        return;
      }

      const to = `+${msg.from}`;
      console.log('[INBOUND]', { from: msg.from, type: msg.type, text: msg.text?.body });

      // ===== GATILHOS DE VENDA =====
      if (msg.type === 'text') {
        const textIn = (msg.text?.body || '').trim().toLowerCase();

        // match robusto (palavra no início)
        const match = /^(menu|oi|olá|ola|comprar|lista|fornecedor(?:es)?|pre(?:ç|c)o|valor)\b/.test(textIn);
        console.log('[MATCH?]', { textIn, match });

        if (match) {
          const orderId = makeOrderId();
          sessions.set(msg.from, { orderId, createdAt: Date.now() });

          const link = buildCheckoutUrl(orderId);
          const resposta =
            `🛍️ ${CONFIG.titulo}\n` +
            `${CONFIG.texto}\n\n` +
            `🧾 Pedido: ${orderId}\n` +        // mostra o número do pedido
            `💰 Preço: ${CONFIG.preco}\n\n` +
            `👉 Pague no link seguro:\n${link}\n\n` +
            `📞 Suporte: ${CONFIG.whatsapp_suporte}`;

          console.log('[SEND oferta]', { to, orderId, link });

          await sendText({
            token: process.env.WHATSAPP_TOKEN,
            phoneNumberId: process.env.PHONE_NUMBER_ID,
            to,
            body: resposta
          });
          return;
        }
      }

      // fallback opcional — sempre tenta responder algo quando for texto
      if (msg.type === 'text') {
        await sendText({
          token: process.env.WHATSAPP_TOKEN,
          phoneNumberId: process.env.PHONE_NUMBER_ID,
          to,
          body: `Recebi: "${msg.text?.body}" ✅`
        });
      }
    } catch (e) {
      console.error('[WEBHOOK] erro:', e?.response?.data || e.message);
    }
  })();
});

// rota de teste de envio
app.get('/send-test', async (req, res) => {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const to = (req.query.to || process.env.TEST_TO || '').replace(/\D/g, '');
    const msg = req.query.msg || 'Teste ok ✅';

    if (!to) return res.status(400).json({ ok: false, error: 'Informe ?to=+55XXXXXXXXX ou defina TEST_TO no .env' });

    const result = await sendText({
      token,
      phoneNumberId,
      to: `+${to}`,
      body: msg
    });

    // normalizar retorno
    return res.status(200).json({ ok: true, data: result });
  } catch (err) {
    console.error('[SEND-TEST] erro:', err?.response?.data || err.message);
    return res.status(500).json({ ok: false, error: 'Falha ao enviar' });
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Servidor WhatsApp rodando na porta ${PORT}`));
