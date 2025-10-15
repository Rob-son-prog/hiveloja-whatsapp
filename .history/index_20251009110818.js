// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { sendText, sendButtons } = require('./phone');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // para forms application/x-www-form-urlencoded

// === SERVE /checkout =========================================================
const staticCheckoutPath = path.join(__dirname, 'checkout');
app.use('/checkout', express.static(staticCheckoutPath));
app.get('/checkout', (_req, res) => res.sendFile(path.join(staticCheckoutPath, 'index.html')));
app.get('/checkout/*', (_req, res) => res.sendFile(path.join(staticCheckoutPath, 'index.html')));
// ============================================================================

// === uploads (multer) ========================================================
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, Date.now() + ext);
  }
});
const upload = multer({ storage });

app.use('/uploads', express.static(UPLOADS_DIR));
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado' });
    const base = process.env.APP_BASE_URL || '';
    const url  = base ? `${base}/uploads/${req.file.filename}` : `/uploads/${req.file.filename}`;
    return res.json({ ok: true, url });
  } catch (e) {
    console.error('[UPLOAD]', e);
    return res.status(500).json({ ok: false, error: 'Falha no upload' });
  }
});
// ============================================================================

// ---------- CONFIG persistente ----------
const CONFIG_PATH = path.join(__dirname, 'config.json');

let CONFIG = {
  // Mensagem padrão (modo 1 produto, se optar)
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
    // no admin você vai trocar para /mp/checkout?product=A&orderId={ORDER_ID}
    checkout_url: 'https://pay.cakto.com.br/SEU_LINK_A?orderId={ORDER_ID}',
  },

  // Produto B
  produtoB: {
    rotulo: 'Produto B',
    titulo: 'Lista com Contatos Extras',
    preco: 'R$ 29,90',
    // no admin você vai trocar para /mp/checkout?product=B&orderId={ORDER_ID}
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

// ---------- Helpers & Sessão ----------
const sessions = new Map(); // memória volátil
const EXPIRE_MS = 30 * 60 * 1000;

function human(text) { return (text || '').trim(); }

function makeOrderId() {
  return 'ORD-' + Date.now().toString(36).toUpperCase().slice(-6);
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

function buildCheckoutUrl(urlTemplate, orderId) {
  return String(urlTemplate || '').replace('{ORDER_ID}', orderId);
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
    (CONFIG.whatsapp_suporte ? `📞 Suporte: ${CONFIG.whatsapp_suporte}` : '')
  );
}

// ---- Saudação com botões (e fallback texto) ----
function buildGreeting(name = '') {
  const templatePadrao =
    'Olá, {NAME}! 👋\n\n' +
    'Tenho duas opções pra você:\n' +
    'A) {PROD_A_TIT} — {PROD_A_PRECO}\n' +
    'B) {PROD_B_TIT} — {PROD_B_PRECO}\n\n' +
    'Toque no botão ou digite A ou B.';

  let tpl = (CONFIG.saudacao && String(CONFIG.saudacao).trim())
    ? CONFIG.saudacao
    : templatePadrao;

  let body = tpl
    .replace('{NAME}', name || '')
    .replace('{PROD_A_TIT}', CONFIG?.produtoA?.titulo || 'Produto A')
    .replace('{PROD_A_PRECO}', CONFIG?.produtoA?.preco || '')
    .replace('{PROD_B_TIT}', CONFIG?.produtoB?.titulo || 'Produto B')
    .replace('{PROD_B_PRECO}', CONFIG?.produtoB?.preco || '');

  body = String(body).replace(/\r/g, '').trim();
  if (!body) body = 'Olá! 👋\n\nEscolha uma opção:\nA) Produto A\nB) Produto B\n\nToque no botão ou digite A ou B.';
  body = body.slice(0, 1024);
  return body;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// =================== MERCADO PAGO (Checkout Pro / SDK v2) ====================
const { MercadoPagoConfig, Preference } = require('mercadopago');
const mpClient = process.env.MP_ACCESS_TOKEN
  ? new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
  : null;

function parsePriceBR(precoStr, fallback = 0) {
  if (!precoStr) return fallback;
  const n = String(precoStr).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const v = Number(n);
  return isNaN(v) ? fallback : v;
}

function absolutize(url) {
  url = String(url || '').trim();
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url; // já é absoluto
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  if (!base) return url; // sem base, mantém relativo
  return url.startsWith('/') ? base + url : `${base}/${url}`;
}

async function createMPPreferenceForProduct(productKey, orderId) {
  if (!mpClient) throw new Error('MP_ACCESS_TOKEN ausente');
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  const prod = CONFIG[`produto${productKey}`] || {};
  const title = prod.titulo || `Produto ${productKey}`;
  const unit_price = parsePriceBR(prod.preco, 19.9);

  const preference = {
    items: [{ title, quantity: 1, unit_price, currency_id: 'BRL' }],
    binary_mode: true,
    statement_descriptor: 'HIVELOJA',
    back_urls: {
      success: `${base}/checkout/sucesso.html`,
      failure: `${base}/checkout/falha.html`,
      pending: `${base}/checkout/pendente.html`,
    },
    auto_return: 'approved',
    metadata: { orderId, productKey },
    notification_url: `${base}/mp/webhook`,
  };

  const pref = new Preference(mpClient);
  const resp = await pref.create({ body: preference });
  const init = resp?.init_point || resp?.sandbox_init_point;
  if (!init) throw new Error('Não foi possível obter init_point do Mercado Pago.');
  return { init_point: init, pref_id: resp?.id || '' };
}

// cria preference e retorna init_point (JSON)
app.post('/mp/create-preference', async (req, res) => {
  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(400).json({ ok: false, error: 'MP_ACCESS_TOKEN não configurado' });
    }
    const productKey = String(req.body.productKey || 'A').toUpperCase() === 'B' ? 'B' : 'A';
    const orderId = req.body.orderId || makeOrderId();
    const data = await createMPPreferenceForProduct(productKey, orderId);
    res.json({ ok: true, orderId, ...data });
  } catch (e) {
    console.error('[MP create-preference]', e?.response?.data || e.message);
    res.status(500).json({ ok: false, error: 'Falha ao criar preferência' });
  }
});

// gera preference e REDIRECIONA para o init_point (para o botão "Comprar")
app.get('/mp/checkout', async (req, res) => {
  try {
    if (!process.env.MP_ACCESS_TOKEN) return res.status(400).send('Config ausente: MP_ACCESS_TOKEN');
    const productKey = String(req.query.product || 'A').toUpperCase() === 'B' ? 'B' : 'A';
    const orderId = req.query.orderId || makeOrderId();
    const { init_point } = await createMPPreferenceForProduct(productKey, orderId);
    return res.redirect(init_point);
  } catch (e) {
    console.error('[MP checkout]', e?.response?.data || e.message);
    return res.status(500).send('Falha ao redirecionar para Mercado Pago');
  }
});

// webhook (opcional – apenas log)
app.post('/mp/webhook', (req, res) => {
  try { console.log('[MP WEBHOOK]', JSON.stringify(req.body || req.query || {}, null, 2)); } catch {}
  res.sendStatus(200);
});
// ============================================================================

async function sendGreeting(to, name) {
  const body = buildGreeting(name);

  // 1) texto completo
  await sendText({ token: process.env.WHATSAPP_TOKEN, phoneNumberId: process.env.PHONE_NUMBER_ID, to, body });

  // 2) lembrete Web
  await sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body: '(Se os botões não aparecerem no WhatsApp Web/PC, responda com A, B ou MENU.)',
  });

  // 3) botões (celular)
  try {
    await sleep(400);
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
  } catch (e) {
    console.error('[BUTTONS] falhou:', e?.response?.data || e.message);
  }
}

async function sendOffer(to, product, orderId) {
  // Usa o checkout_url do produto escolhido (A/B)
  let link;
  const urlTpl = String(product?.checkout_url || '').trim();

  if (urlTpl.startsWith('mp:')) {
    // modo "mp:auto": cria a preferência na hora
    try {
      const keyGuess = (product === CONFIG.produtoB) ? 'B' : 'A';
      const { init_point } = await createMPPreferenceForProduct(keyGuess, orderId);
      link = init_point;
    } catch (e) {
      console.error('[sendOffer] MP error:', e?.response?.data || e.message);
      link = buildCheckoutUrl(urlTpl, orderId); // fallback
    }
  } else {
    link = buildCheckoutUrl(urlTpl, orderId);
  }

  // se o link for relativo (/mp/checkout?...), torna absoluto para o WhatsApp
  link = absolutize(link);

  const title   = product?.titulo || 'Oferta';
  const price   = product?.preco  || '';
  const suporte = CONFIG.whatsapp_suporte || '';

  const body =
    `📦 ${title}\n` +
    (price ? `💰 Preço: ${price}\n\n` : '\n') +
    `🧾 Pedido: ${orderId}\n` +
    (link  ? `👉 Pague no link seguro:\n${link}\n\n` : '\n') +
    (suporte ? `📞 Suporte: ${suporte}` : '');

  // 1) texto da oferta
  await sendText({ token: process.env.WHATSAPP_TOKEN, phoneNumberId: process.env.PHONE_NUMBER_ID, to, body });

  // 2) lembrete
  await sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body: '(Para voltar ao menu, digite: MENU)',
  });

  // 3) botão "Menu"
  try {
    await sendButtons({
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      to,
      body: '⬅️ Voltar ao menu',
      buttons: [{ id: 'MENU', title: 'Menu' }],
    });
  } catch (e) {
    console.error('[sendOffer buttons] erro:', e?.response?.data || e.message);
  }
}

// Modo antigo: 1 produto (opcional)
async function sendDefaultOneProduct(to) {
  const orderId = makeOrderId();
  const link = absolutize(buildCheckoutUrl(CONFIG.checkout_url, orderId));

  const body =
    `🛍️ ${CONFIG.titulo}\n` +
    `${CONFIG.texto}\n\n` +
    `🧾 Pedido: ${orderId}\n` +
    `💰 Preço: ${CONFIG.preco}\n\n` +
    `👉 Pague no link seguro:\n${link}\n\n` +
    (CONFIG.whatsapp_suporte ? `📞 Suporte: ${CONFIG.whatsapp_suporte}` : '');

  return sendText({ token: process.env.WHATSAPP_TOKEN, phoneNumberId: process.env.PHONE_NUMBER_ID, to, body });
}

// ---------- Rotas de painel/config ----------
app.get('/config', (_req, res) => res.json(CONFIG));

app.post('/config', (req, res) => {
  try {
    const patch = req.body || {};
    const assignIf = (obj, key, val) => {
      if (val === undefined) return;
      if (typeof val === 'string' && val.trim() === '') return;
      obj[key] = val;
    };

    ['titulo','texto','preco','whatsapp_suporte','checkout_url','saudacao'].forEach(k => {
      assignIf(CONFIG, k, patch[k]);
    });

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

// painel estático
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
  res.sendStatus(200);

  (async () => {
    try {
      const body = req.body;
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const msg   = value?.messages?.[0];
      if (!value || !msg) return;

      const myWaba = value?.metadata?.phone_number_id;
      if (String(msg.from) === String(myWaba)) return;

      const to   = `+${msg.from}`;
      const name = value?.contacts?.[0]?.profile?.name || '';
      const s    = touchSession(msg.from);

      // BOTÕES (Cloud API nova)
      if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
        const payload = String(msg.interactive.button_reply.id || '').toUpperCase();
        if (payload === 'CHOOSE_A') { const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoA, orderId); return; }
        if (payload === 'CHOOSE_B') { const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoB, orderId); return; }
        if (payload === 'MENU')     { s.stage = 'waiting_choice'; await sendGreeting(to, name); return; }
      }

      // BOTÕES (formato antigo)
      if (msg.type === 'button' && msg?.button?.payload) {
        const payload = String(msg.button.payload || '').toUpperCase();
        if (payload === 'CHOOSE_A') { const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoA, orderId); return; }
        if (payload === 'CHOOSE_B') { const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoB, orderId); return; }
        if (payload === 'MENU')     { s.stage = 'waiting_choice'; await sendGreeting(to, name); return; }
      }

      // TEXTO
      if (msg.type === 'text') {
        const textIn = human(msg.text?.body).toLowerCase();

        if (['reset','reiniciar','recomeçar','inicio','início'].includes(textIn)) {
          sessions.delete(msg.from);
          touchSession(msg.from);
          await sendGreeting(to, name);
          return;
        }

        if (['menu','oi','olá','ola','iniciar','começar','comecar','inicio','início'].includes(textIn)) {
          s.stage = 'waiting_choice';
          await sendGreeting(to, name);
          return;
        }

        if (['a','1','produto a','oferta a'].includes(textIn)) {
          const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoA, orderId); return;
        }
        if (['b','2','produto b','oferta b'].includes(textIn)) {
          const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoB, orderId); return;
        }

        const matchStart = /^(comprar|lista|fornecedor(?:es)?|pre(?:ç|c)o|valor)\b/.test(textIn);
        if (matchStart) {
          s.stage = 'waiting_choice';
          await sendGreeting(to, name);
          return;
        }

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
});

// ---------- Start ----------
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Servidor WhatsApp rodando na porta ${PORT}`));
