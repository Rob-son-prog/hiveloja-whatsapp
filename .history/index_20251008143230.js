// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const { sendText, sendButtons } = require('./phone');

const app = express();
app.use(express.json());

// ---------- CONFIG persistente ----------
const CONFIG_PATH = path.join(__dirname, 'config.json');

let CONFIG = {
  // Mensagem padrão (quando quiser empurrar 1 oferta direta)
  titulo: 'Lista de Fornecedores de Atacado',
  texto: 'Receba a lista completa imediatamente após o pagamento.',
  preco: 'R$ 19,90',
  whatsapp_suporte: '+5565984361007',
  checkout_url: 'https://pay.cakto.com.br/SEU_LINK?orderId={ORDER_ID}',

  // Saudação + botões
  saudacao:
    'Olá, {NAME}! 👋\n\n' +
    'Tenho duas opções pra você:\n' +
    'A) {PROD_A_TIT} — {PROD_A_PRECO}\n' +
    'B) {PROD_B_TIT} — {PROD_B_PRECO}\n\n' +
    'Toque no botão ou digite A ou B.\n' +
    '(Se os botões não aparecerem, digite A ou B).',

  // Produto A
  produtoA: {
    rotulo: 'Produto A',
    titulo: 'Lista de Fornecedores Premium',
    preco: 'R$ 19,90',
    checkout_url: 'https://pay.cakto.com.br/SEU_LINK_A?orderId={ORDER_ID}',
  },

  // Produto B
  produtoB: {
    rotulo: 'Produto B',
    titulo: 'Lista com Contatos Extras',
    preco: 'R$ 29,90',
    checkout_url: 'https://pay.cakto.com.br/SEU_LINK_B?orderId={ORDER_ID}',
  },
};

// Carrega config do disco (se existir)
try {
  if (fs.existsSync(CONFIG_PATH)) {
    CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
} catch (e) {
  console.error('Falha ao ler config.json:', e);
}

// Salva no disco
function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG, null, 2));
}

// ---------- Helpers ----------
const sessions = new Map(); // memória volátil
const EXPIRE_MS = 30 * 60 * 1000;

function makeOrderId() {
  // ex.: ORD-1A2B3C
  return 'ORD-' + Date.now().toString(36).toUpperCase().slice(-6);
}

function buildCheckoutUrlFor(productKey, orderId) {
  const prod = CONFIG[`produto${productKey}`] || {};
  const url = String(prod.checkout_url || '').trim();
  return url.replace('{ORDER_ID}', orderId);
}

function buildProductText(productKey, orderId) {
  const prod = CONFIG[`produto${productKey}`] || {};
  const titulo = prod.titulo || `Produto ${productKey}`;
  const preco  = prod.preco  || '';
  const link   = buildCheckoutUrlFor(productKey, orderId);

  return (
    `📦 ${titulo}\n` +
    (preco ? `💰 Preço: ${preco}\n\n` : '\n') +
    `🧾 Pedido: ${orderId}\n` +
    `👉 Pague no link seguro:\n${link}\n\n` +
    `📞 Suporte: ${CONFIG.whatsapp_suporte}`
  );
}

// -> saudação com fallback seguro
function buildGreeting(name = '') {
  const templatePadrao =
    'Olá, {NAME}! 👋\n\n' +
    'Tenho duas opções pra você:\n' +
    'A) {PROD_A_TIT} — {PROD_A_PRECO}\n' +
    'B) {PROD_B_TIT} — {PROD_B_PRECO}\n\n' +
    'Toque no botão ou digite A ou B.';

  let tpl = (CONFIG.saudacao && String(CONFIG.saudacao).trim()) ? CONFIG.saudacao : templatePadrao;

  const a = CONFIG?.produtoA || {};
  const b = CONFIG?.produtoB || {};
  let body = tpl
    .replace('{NAME}', name || '')
    .replace('{PROD_A_TIT}', a.titulo || 'Produto A')
    .replace('{PROD_A_PRECO}', a.preco || '')
    .replace('{PROD_B_TIT}', b.titulo || 'Produto B')
    .replace('{PROD_B_PRECO}', b.preco || '');

  body = String(body).replace(/\r/g, '').trim();
  if (!body) body = 'Olá! 👋\n\nEscolha uma opção:\nA) Produto A\nB) Produto B\n\nToque no botão ou digite A ou B.';
  body = body.slice(0, 1024); // limite WhatsApp

  return body;
}

async function sendGreeting(to, name) {
  const body = buildGreeting(name);

  // 1) envia os botões
  await sendButtons({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body,
    buttons: [
      { id: 'CHOOSE_A', title: CONFIG?.produtoA?.rotulo || 'Produto A' },
      { id: 'CHOOSE_B', title: CONFIG?.produtoB?.rotulo || 'Produto B' },
      { id: 'MENU',     title: 'Menu' },
    ],
  });

  // 2) espelho em texto (para WhatsApp Web/desktop)
  await sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body: '⚠️ Se os botões não aparecerem no WhatsApp Web/PC, responda com A, B ou MENU.',
  });
}

async function sendProductOffer(to, productKey) {
  const orderId = makeOrderId();
  const text = buildProductText(productKey, orderId);

  await sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body: text,
  });
}

function buildCheckoutUrl(urlTemplate, orderId) {
  return String(urlTemplate || '').replace('{ORDER_ID}', orderId);
}

function human(text) {
  return (text || '').trim();
}

function buildGreeting(name = '') {
  // template padrão caso CONFIG.saudacao esteja vazia
  const templatePadrao =
    'Olá, {NAME}! 👋\n\n' +
    'Tenho duas opções pra você:\n' +
    'A) {PROD_A_TIT} — {PROD_A_PRECO}\n' +
    'B) {PROD_B_TIT} — {PROD_B_PRECO}\n\n' +
    'Toque no botão ou digite A ou B.';

  // escolhe template válido
  let tpl = (CONFIG.saudacao && String(CONFIG.saudacao).trim()) ? CONFIG.saudacao : templatePadrao;

  // substitui placeholders
  let body = tpl
    .replace('{NAME}', name || '')
    .replace('{PROD_A_TIT}', CONFIG?.produtoA?.titulo || 'Produto A')
    .replace('{PROD_A_PRECO}', CONFIG?.produtoA?.preco || '')
    .replace('{PROD_B_TIT}', CONFIG?.produtoB?.titulo || 'Produto B')
    .replace('{PROD_B_PRECO}', CONFIG?.produtoB?.preco || '');

  // higieniza + garante não-vazio + limita a 1024 chars (limite do WhatsApp)
  body = String(body).replace(/\r/g, '').trim();
  if (!body) body = 'Olá! 👋\n\nEscolha uma opção:\nA) Produto A\nB) Produto B\n\nToque no botão ou digite A ou B.';
  body = body.slice(0, 1024);
  return body;
}

async function sendGreeting(to, name) {
  const body = buildGreeting(name);

  try {
    return await sendButtons({
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      to,
      body,
      buttons: [
        { id: 'CHOOSE_A', title: CONFIG?.produtoA?.rotulo || 'Produto A' },
        { id: 'CHOOSE_B', title: CONFIG?.produtoB?.rotulo || 'Produto B' },
        { id: 'MENU',     title: 'Menu' },
      ],
    });
  } catch (e) {
    // Fallback em texto caso o interativo falhe (ex.: template inválido ou janela de 24h)
    console.error('[BUTTONS] falhou, enviando fallback de texto:', e?.response?.data || e.message);
    return sendText({
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      to,
      body: body + '\n\n(Se os botões não aparecerem, digite A ou B.)',
    });
  }
}


async function sendOffer(to, product, orderId) {
  const link = buildCheckoutUrl(product?.checkout_url, orderId);
  const title = product?.titulo || 'Oferta';
  const price = product?.preco || '';
  const suporte = CONFIG.whatsapp_suporte || '';

  const body =
    `📦 ${title}\n` +
    (price ? `💰 Preço: ${price}\n\n` : '\n') +
    `🧾 Pedido: ${orderId}\n` +
    `👉 Pague no link seguro:\n${link}\n\n` +
    (suporte ? `📞 Suporte: ${suporte}` : '');

  return sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body,
  });
}

async function sendDefaultOneProduct(to) {
  // “Mensagem padrão (“menu”)” — 1 produto direto (modo antigo)
  const orderId = makeOrderId();
  const link = buildCheckoutUrl(CONFIG.checkout_url, orderId);

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
    body,
  });
}

function touchSession(from) {
  const now = Date.now();
  let s = sessions.get(from);
  if (!s || now - (s.createdAt || 0) > EXPIRE_MS) {
    s = { stage: 'new', createdAt: now };
    sessions.set(from, s);
  } else {
    s.createdAt = now;
  }
  return s;
}

// ---------- Rotas de painel/config ----------
app.get('/config', (_req, res) => res.json(CONFIG));

app.post('/config', (req, res) => {
  try {
    const patch = req.body || {};

    // helper pra não sobrescrever com string vazia
    const assignIf = (obj, key, val) => {
      if (val === undefined) return;
      if (typeof val === 'string' && val.trim() === '') return; // ignora vazio
      obj[key] = val;
    };

    // campos simples
    ['titulo','texto','preco','whatsapp_suporte','checkout_url','saudacao'].forEach(k => {
      assignIf(CONFIG, k, patch[k]);
    });

    // produtos (merge pontual, ignorando vazios)
    if (patch.produtoA) {
      CONFIG.produtoA = { ...CONFIG.produtoA };
      ['rotulo','titulo','preco','checkout_url'].forEach(k => assignIf(CONFIG.produtoA, k, patch.produtoA[k]));
    }
    if (patch.produtoB) {
      CONFIG.produtoB = { ...CONFIG.produtoB };
      ['rotulo','titulo','preco','checkout_url'].forEach(k => assignIf(CONFIG.produtoB, k, patch.produtoB[k]));
    }

    saveConfig();
    res.json({ ok: true, CONFIG });
  } catch (e) {
    console.error('[CONFIG] erro ao salvar:', e);
    res.status(400).json({ ok: false, error: 'Config inválida' });
  }
});

// Servir a pasta do painel
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ---------- Logs de boot ----------
console.log('[BOOT] TOKEN prefix:', (process.env.WHATSAPP_TOKEN || '').slice(0, 3));
console.log('[BOOT] PHONE_NUMBER_ID:', process.env.PHONE_NUMBER_ID);
console.log('[BOOT] TEST_TO:', process.env.TEST_TO);

// ---------- Rotas simples ----------
app.get('/', (_req, res) => res.send('ok'));
app.get('/send-ok', (_req, res) => res.send('send-ok'));

app.get('/send-test', async (req, res) => {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const to = (req.query.to || process.env.TEST_TO || '').replace(/\D/g, '');
    const msg = req.query.msg || 'Teste ok ✅';

    if (!to) return res.status(400).json({ ok: false, error: 'Informe ?to=+55XXXXXXXXX ou defina TEST_TO no .env' });

    const data = await sendText({ token, phoneNumberId, to: `+${to}`, body: msg });
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[SEND-TEST] erro:', e?.response?.data || e.message);
    res.status(500).json({ ok: false, error: 'Falha ao enviar' });
  }
});

// ---------- Webhook: VERIFY (GET) ----------
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || '').trim();
  const mode = (req.query['hub.mode'] || '').trim();
  const token = (req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'] || '';
  console.log('[WEBHOOK VERIFY]', { mode, token, expected: VERIFY_TOKEN, challenge });
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ---------- Webhook: eventos (POST) ----------
app.post('/webhook', (req, res) => {
  // responde 200 rapidamente para o Meta não reenviar
  res.sendStatus(200);

  (async () => {
    try {
      const body = req.body;

      // Extrai value e msg (pode chegar apenas status)
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const msg   = value?.messages?.[0];
      if (!value || !msg) return;

      // Evita eco (mensagens que você mesmo enviou)
      const myWaba = value?.metadata?.phone_number_id;
      if (String(msg.from) === String(myWaba)) return;

      const to   = `+${msg.from}`;
      const name = value?.contacts?.[0]?.profile?.name || '';
      const s    = touchSession(msg.from);

      // ---------------- BOTÕES ----------------
      // Cloud API moderna (interactive.button_reply)
      if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
        const payload = String(msg.interactive.button_reply.id || '').toUpperCase();

        if (payload === 'CHOOSE_A') {
          const orderId = makeOrderId();
          await sendOffer(to, CONFIG.produtoA, orderId);
          return;
        }
        if (payload === 'CHOOSE_B') {
          const orderId = makeOrderId();
          await sendOffer(to, CONFIG.produtoB, orderId);
          return;
        }
        if (payload === 'MENU') {
          s.stage = 'waiting_choice';
          await sendGreeting(to, name);
          return;
        }
      }

      // Formato antigo (msg.type === 'button' com payload)
      if (msg.type === 'button' && msg?.button?.payload) {
        const payload = String(msg.button.payload || '').toUpperCase();

        if (payload === 'CHOOSE_A') {
          const orderId = makeOrderId();
          await sendOffer(to, CONFIG.produtoA, orderId);
          return;
        }
        if (payload === 'CHOOSE_B') {
          const orderId = makeOrderId();
          await sendOffer(to, CONFIG.produtoB, orderId);
          return;
        }
        if (payload === 'MENU') {
          s.stage = 'waiting_choice';
          await sendGreeting(to, name);
          return;
        }
      }

      // ---------------- TEXTO ----------------
      if (msg.type === 'text') {
        const textIn = human(msg.text?.body).toLowerCase();

        // reset da conversa
        if (['reset', 'reiniciar', 'recomeçar', 'inicio', 'início'].includes(textIn)) {
          sessions.delete(msg.from);
          touchSession(msg.from);
          await sendGreeting(to, name);
          return;
        }

        // voltar ao menu / iniciar
        if (['menu', 'oi', 'olá', 'ola', 'iniciar', 'começar', 'comecar', 'inicio', 'início'].includes(textIn)) {
          s.stage = 'waiting_choice';
          await sendGreeting(to, name);
          return;
        }

        // escolha textual A / B
        if (['a', '1', 'produto a', 'oferta a'].includes(textIn)) {
          const orderId = makeOrderId();
          await sendOffer(to, CONFIG.produtoA, orderId);
          return;
        }
        if (['b', '2', 'produto b', 'oferta b'].includes(textIn)) {
          const orderId = makeOrderId();
          await sendOffer(to, CONFIG.produtoB, orderId);
          return;
        }

        // gatilhos gerais -> mostra saudação com botões
        const matchStart = /^(comprar|lista|fornecedor(?:es)?|pre(?:ç|c)o|valor)\b/.test(textIn);
        if (matchStart) {
          s.stage = 'waiting_choice';
          await sendGreeting(to, name);
          return;
        }

        // fallback: eco
        await sendText({
          token: process.env.WHATSAPP_TOKEN,
          phoneNumberId: process.env.PHONE_NUMBER_ID,
          to,
          body: `Recebi: "${msg.text?.body}" ✅`,
        });
        return;
      }

    } catch (e) {
      console.error('[WEBHOOK] erro:', e?.response?.data || e.message);
    }
  })();

  // normaliza texto (remove acentos e espaços extras)
function human(s = '') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// sessão simples com expiração
const sessions = new Map();
const EXPIRE_MS = 30 * 60 * 1000; // 30 min

function touchSession(key) {
  const now = Date.now();
  let s = sessions.get(key);
  if (!s || (now - (s.createdAt || 0)) > EXPIRE_MS) {
    s = { stage: 'new', createdAt: now };
    sessions.set(key, s);
  }
  return s;
}

function makeOrderId() {
  return 'ORD-' + Date.now().toString(36).toUpperCase().slice(-6);
}

function buildCheckoutUrlFor(product, orderId) {
  // tenta url do produto; senão cai na URL padrão
  const url = (product && product.checkout_url) || CONFIG.checkout_url || '';
  return url.replace('{ORDER_ID}', orderId);
}

/**
 * Envia a saudação com 3 botões (Produto A, Produto B, Menu)
 * + espelho em texto (para quem estiver no WhatsApp Web).
 */
async function sendGreeting(to, name = '') {
  const saudNome = name ? `, ${name}` : '';
  const txtSaud = (CONFIG.saudacao || (
    `Olá${saudNome}! 👋\n\n` +
    `Tenho duas opções pra você:\n` +
    `A) ${CONFIG?.produtoA?.titulo || 'Produto A'} — ${CONFIG?.produtoA?.preco || ''}\n` +
    `B) ${CONFIG?.produtoB?.titulo || 'Produto B'} — ${CONFIG?.produtoB?.preco || ''}\n\n` +
    `Toque nos botões abaixo ou digite A/B/Menu.`
  ));

  // 1) Envia botões (funciona no celular)
  try {
    await sendButtons({
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      to,
      body: txtSaud,
      buttons: [
        { id: 'CHOOSE_A', title: CONFIG?.produtoA?.rotulo || 'Produto A' },
        { id: 'CHOOSE_B', title: CONFIG?.produtoB?.rotulo || 'Produto B' },
        { id: 'MENU',     title: 'Menu' },
      ],
    });
  } catch (e) {
    console.error('[sendGreeting buttons] erro:', e?.response?.data || e.message);
  }

  // 2) Envia espelho em texto (útil para WhatsApp Web)
  try {
    await sendText({
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      to,
      body:
        txtSaud +
        `\n\n(Se os botões não aparecerem, digite: A, B ou MENU.)`,
    });
  } catch (e) {
    console.error('[sendGreeting text] erro:', e?.response?.data || e.message);
  }
}

/**
 * Envia a oferta do produto escolhido + botão "Menu" para voltar.
 * Também envia espelho em texto.
 */
async function sendOffer(to, product, orderId) {
  const titulo = product?.titulo || 'Oferta';
  const preco  = product?.preco  || '';
  const link   = buildCheckoutUrlFor(product, orderId);

  const texto =
    `🛍️ ${titulo}\n` +
    (CONFIG?.texto || '') + (CONFIG?.texto ? '\n\n' : '') +
    (orderId ? `🧾 Pedido: ${orderId}\n` : '') +
    (preco ? `💰 Preço: ${preco}\n` : '') +
    (link  ? `👉 Pague no link seguro:\n${link}\n` : '') +
    (CONFIG?.whatsapp_suporte ? `\n📞 Suporte: ${CONFIG.whatsapp_suporte}` : '');

  // 1) Mensagem com botão "Menu" (celular)
  try {
    await sendButtons({
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      to,
      body: texto,
      buttons: [
        { id: 'MENU', title: 'Menu' },
      ],
    });
  } catch (e) {
    console.error('[sendOffer buttons] erro:', e?.response?.data || e.message);
  }

  // 2) Espelho em texto (Web)
  try {
    await sendText({
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      to,
      body: texto + `\n\n(Para voltar, digite: MENU)`,
    });
  } catch (e) {
    console.error('[sendOffer text] erro:', e?.response?.data || e.message);
  }
}

});

// ---------- Start ----------
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Servidor WhatsApp rodando na porta ${PORT}`));
