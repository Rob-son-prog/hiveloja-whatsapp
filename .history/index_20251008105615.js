// index.js
require('dotenv').config();
const express = require('express');
// Se você tiver sendButtons no phone.js, exporte e descomente:
// const { sendText, sendButtons } = require('./phone');
const { sendText } = require('./phone');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// -------------------- CONFIG persistente --------------------
const CONFIG_PATH = path.join(__dirname, 'config.json');

let CONFIG = {
  // Oferta GERAL (comando "menu")
  titulo: "Lista de Fornecedores de Atacado",
  texto: "Receba a lista completa imediatamente após o pagamento.",
  preco: "R$ 19,90",
  whatsapp_suporte: "+5565984361007",
  checkout_url: "https://pay.cakto.com.br/SEU_LINK?orderId={ORDER_ID}",

  // Saudação + botões A/B
  saudacao:
    "Olá, {NAME}! 👋\n\n" +
    "Tenho duas opções pra você:\n" +
    "A) Lista de Fornecedores Premium — R$ 19,90\n" +
    "B) Lista com Contatos Extras — R$ 29,90\n\n" +
    "Toque no botão ou digite A ou B.",

  produtoA: {
    rotulo: "Produto A",
    titulo: "Lista de Fornecedores Premium",
    preco: "R$ 19,90",
    checkout_url: "https://pay.cakto.com.br/SEU_LINK_A?orderId={ORDER_ID}"
  },
  produtoB: {
    rotulo: "Produto B",
    titulo: "Lista com Contatos Extras",
    preco: "R$ 29,90",
    checkout_url: "https://pay.cakto.com.br/SEU_LINK_B?orderId={ORDER_ID}"
  }
};

// carrega config.json se existir
try {
  if (fs.existsSync(CONFIG_PATH)) {
    CONFIG = { ...CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  }
} catch (e) {
  console.error('Falha ao ler config.json:', e);
}

// salva config.json
function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG, null, 2));
}

// -------------------- Helpers --------------------
const sessions = new Map(); // memória simples
const EXPIRE_MS = 30 * 60 * 1000;

function makeOrderId() {
  return 'ORD-' + Date.now().toString(36).toUpperCase().slice(-6);
}

function fillOrder(url, orderId) {
  return String(url || '').replace('{ORDER_ID}', orderId);
}

function deepMerge(target, src) {
  for (const k of Object.keys(src || {})) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = deepMerge(target[k] || {}, v);
    } else if (v !== undefined) {
      target[k] = v;
    }
  }
  return target;
}

async function sendGreeting(to, name) {
  const saud = (CONFIG.saudacao || '')
    .replace('{NAME}', name || '').replace('  ', ' ');
  // Se você tiver sendButtons no phone.js, descomente esse bloco:
  /*
  if (typeof sendButtons === 'function') {
    return sendButtons({
      to,
      body: saud,
      buttons: [
        { id: 'CHOOSE_A', title: CONFIG.produtoA?.rotulo || 'Produto A' },
        { id: 'CHOOSE_B', title: CONFIG.produtoB?.rotulo || 'Produto B' },
      ],
    });
  }
  */
  // Fallback texto
  return sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body: saud + "\n\n(Se os botões não aparecerem, digite A ou B.)"
  });
}

async function sendOffer(to, produto, orderId) {
  const link = fillOrder(produto.checkout_url, orderId);
  const body =
    `🛍️ ${produto.titulo}\n` +
    `💰 Preço: ${produto.preco}\n\n` +
    `🧾 Pedido: ${orderId}\n` +
    `👉 Pague no link seguro:\n${link}\n\n` +
    `📞 Suporte: ${CONFIG.whatsapp_suporte}`;
  return sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body
  });
}

async function sendMenuOffer(to, orderId) {
  const link = fillOrder(CONFIG.checkout_url, orderId);
  const body =
    `🛍️ ${CONFIG.titulo}\n` +
    `${CONFIG.texto}\n\n` +
    `🧾 Pedido: ${orderId}\n` +
    `💰 Preço: ${CONFIG.preco}\n\n` +
    `👉 Pague no link seguro:\n${link}\n\n` +
    `📞 Suporte: ${CONFIG.whatsapp_suporte}`;
  return sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body
  });
}

// -------------------- Rotas do painel --------------------
app.get('/config', (_req, res) => res.json(CONFIG));

app.post('/config', (req, res) => {
  // aceita campos simples e objetos aninhados (produtoA/B, saudacao)
  try {
    CONFIG = deepMerge(CONFIG, req.body || {});
    saveConfig();
    return res.json({ ok: true, CONFIG });
  } catch (e) {
    console.error('[CONFIG] erro ao salvar:', e);
    return res.status(400).json({ ok: false, error: 'Config inválida' });
  }
});

// servir o painel estático
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// -------------------- Logs de boot --------------------
console.log('[BOOT] TOKEN prefix:', (process.env.WHATSAPP_TOKEN || '').slice(0, 3));
console.log('[BOOT] PHONE_NUMBER_ID:', process.env.PHONE_NUMBER_ID);
console.log('[BOOT] TEST_TO:', process.env.TEST_TO);

// -------------------- Rotas simples --------------------
app.get('/', (_req, res) => res.send('ok'));
app.get('/send-ok', (_req, res) => res.send('send-ok'));

// -------------------- Webhook VERIFY (GET) --------------------
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || '').trim();
  const mode = (req.query['hub.mode'] || '').trim();
  const token = (req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'] || '';
  console.log('[WEBHOOK VERIFY] mode=', mode, ' token=', token, ' expected=', VERIFY_TOKEN, ' challenge=', challenge);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// -------------------- Webhook EVENTS (POST) --------------------
app.post('/webhook', async (req, res) => {
  // responde 200 imediatamente para o Meta
  res.sendStatus(200);

  try {
    const body = req.body;
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg   = value?.messages?.[0];

    // Se não é mensagem (pode ser status)
    if (!value || !msg) return;

    // Ignora eco do próprio WABA
    const myWaba = value?.metadata?.phone_number_id;
    if (String(msg.from) === String(myWaba)) return;

    const to = `+${msg.from}`;
    const name = value?.contacts?.[0]?.profile?.name || '';

    // --------- Sessão com expiração ---------
    const now = Date.now();
    let sess = sessions.get(msg.from);
    if (!sess || (now - (sess.createdAt || 0)) > EXPIRE_MS) {
      sess = { stage: 'new', createdAt: now };
      sessions.set(msg.from, sess);
    }

    // --------- RESET ---------
    if (msg.type === 'text') {
      const t = (msg.text?.body || '').trim().toLowerCase();
      if (['reset','reiniciar','recomeçar','inicio','início'].includes(t)) {
        sessions.delete(msg.from);
        sessions.set(msg.from, { stage: 'new', createdAt: Date.now() });
        await sendGreeting(to, name);
        return;
      }
    }

    // --------- Stage: new → enviar saudação ---------
    if (sess.stage === 'new') {
      sess.stage = 'waiting_choice';
      await sendGreeting(to, name);
      return;
    }

    // --------- Escolha por botão ---------
    if (msg.type === 'button' && msg?.button?.payload) {
      const payload = (msg.button.payload || '').toUpperCase();
      const orderId = makeOrderId();
      if (payload === 'CHOOSE_A') {
        await sendOffer(to, CONFIG.produtoA, orderId);
        return;
      }
      if (payload === 'CHOOSE_B') {
        await sendOffer(to, CONFIG.produtoB, orderId);
        return;
      }
    }

    // --------- Escolha por TEXTO ---------
    if (msg.type === 'text') {
      const textIn = (msg.text?.body || '').trim().toLowerCase();

      // menu → oferta geral
      if (/^menu\b/.test(textIn)) {
        const orderId = makeOrderId();
        await sendMenuOffer(to, orderId);
        return;
      }

      // match A/B (A, 1, "oferta a", rótulo do botão/rotulo do produto etc.)
      const rotA = (CONFIG.produtoA?.rotulo || 'A').toLowerCase();
      const rotB = (CONFIG.produtoB?.rotulo || 'B').toLowerCase();

      const isA = /^(a|1)\b/.test(textIn) || textIn.includes(rotA) || textIn.includes('produto a') || textIn.includes('oferta a');
      const isB = /^(b|2)\b/.test(textIn) || textIn.includes(rotB) || textIn.includes('produto b') || textIn.includes('oferta b');

      if (isA) {
        const orderId = makeOrderId();
        await sendOffer(to, CONFIG.produtoA, orderId);
        return;
      }
      if (isB) {
        const orderId = makeOrderId();
        await sendOffer(to, CONFIG.produtoB, orderId);
        return;
      }

      // --------- Gatilhos legados de venda (palavras) → oferta geral ---------
      const matchGeral = /^(oi|olá|ola|comprar|lista|fornecedor(?:es)?|pre(?:ç|c)o|valor)\b/.test(textIn);
      if (matchGeral) {
        const orderId = makeOrderId();
        await sendMenuOffer(to, orderId);
        return;
      }

      // fallback: eco
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
});

// -------------------- /send-test --------------------
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

    return res.status(200).json({ ok: true, data: result });
  } catch (err) {
    console.error('[SEND-TEST] erro:', err?.response?.data || err.message);
    return res.status(500).json({ ok: false, error: 'Falha ao enviar' });
  }
});

// -------------------- Start --------------------
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Servidor WhatsApp rodando na porta ${PORT}`));
