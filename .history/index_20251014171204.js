// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { sendText, sendButtons, sendDocument, sendVideo } = require('./phone');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === SERVE /checkout =========================================================
const staticCheckoutPath = path.join(__dirname, 'checkout');
app.use('/checkout', express.static(staticCheckoutPath));
app.get('/checkout', (_req, res) => {
  res.sendFile(path.join(staticCheckoutPath, 'index.html'));
});
app.get('/checkout/*', (_req, res) => {
  res.sendFile(path.join(staticCheckoutPath, 'index.html'));
});
// ============================================================================

// --- [CAMPANHAS] armazenamento em disco -------------------------------
const CAMPAIGN_PATH = path.join(__dirname, 'campaign.json');
const CONTACTS_PATH = path.join(__dirname, 'contacts.json');

let CONTACTS = {}; // { "+5565...": { name, lastSeen, purchased } }
try { if (fs.existsSync(CONTACTS_PATH)) CONTACTS = JSON.parse(fs.readFileSync(CONTACTS_PATH,'utf8')); } catch {}
const saveContacts = () => fs.writeFileSync(CONTACTS_PATH, JSON.stringify(CONTACTS,null,2));

// salva campanha atual
app.post('/campaigns/save', (req, res) => {
  try {
    const camp = req.body || {};
    fs.writeFileSync(CAMPAIGN_PATH, JSON.stringify(camp, null, 2));
    return res.json({ ok: true });
  } catch (e) {
    console.error('[campaigns/save]', e);
    return res.status(500).json({ ok: false, error: 'Falha ao salvar campanha' });
  }
});

// roda campanha agora (modo simples texto dentro de 24h)
app.post('/campaigns/run-now', async (req, res) => {
  try {
    const camp = fs.existsSync(CAMPAIGN_PATH) ? JSON.parse(fs.readFileSync(CAMPAIGN_PATH,'utf8')) : (req.body||{});
    const now = Date.now();

    const minS = Number(camp.throttle_seconds_min || 60);
    const maxS = Number(camp.throttle_seconds_max || 150);
    const lastDays = Number(camp.filter?.last_incoming_gte_days || 0);
    const excludePaid = !!camp.filter?.exclude_paid;

    // população de destino
    let numbers = Object.entries(CONTACTS)
      .filter(([num, c]) => {
        if (!c?.lastSeen) return false;
        const days = (now - c.lastSeen) / (1000*60*60*24);
        if (days < lastDays) return false;
        if (excludePaid && c.purchased) return false;
        return true;
      })
      .map(([num]) => num);

    // modo teste (envia só para um número específico)
    if (camp.test_to && String(camp.test_to).trim()) {
      numbers = [ String(camp.test_to).trim() ];
    }

    // respeita janela: apenas texto livre (dentro de 24h)
    const text24 = (camp.content?.text_24h || '').trim();
    if (!text24) return res.status(400).json({ ok:false, error:'Mensagem (24h) vazia' });

    // dispara com intervalos aleatórios
    let delay = 0;
    numbers.forEach((to) => {
      const jitter = (Math.random()*(maxS-minS)+minS)*1000;
      delay += jitter;
      setTimeout(async () => {
        try {
          // 1) envia o texto da campanha
          await sendText({
            token: process.env.WHATSAPP_TOKEN,
            phoneNumberId: process.env.PHONE_NUMBER_ID,
            to,
            body: personalize(text24, to)
          });

          // 2) envia botões de ação (A / B / Menu)
          try {
            await sendButtons({
              token: process.env.WHATSAPP_TOKEN,
              phoneNumberId: process.env.PHONE_NUMBER_ID,
              to,
              body: 'Escolha uma opção:',
              buttons: [
                { id: 'CHOOSE_A', title: (CONFIG?.produtoA?.rotulo || 'Produto A').slice(0,20) },
                { id: 'CHOOSE_B', title: (CONFIG?.produtoB?.rotulo || 'Produto B').slice(0,20) },
                { id: 'MENU',     title: 'Menu' }
              ],
            });
          } catch (e) {
            console.error('[campaign buttons] falhou', e?.response?.data || e.message);
          }

          console.log('[campaign] enviado para', to);
        } catch (e) {
          console.error('[campaign] falha', to, e?.response?.data || e.message);
        }
      }, delay);
    });

    return res.json({ ok:true, queued: numbers.length });
  } catch (e) {
    console.error('[campaigns/run-now]', e);
    return res.status(500).json({ ok:false, error:'Falha ao iniciar campanha' });
  }
});

// simples personalização: {NAME}, {PROD_A_TIT}, etc.
function personalize(text, to){
  const name = CONTACTS[to]?.name || '';
  return String(text)
    .replaceAll('{NAME}', name)
    .replaceAll('{PROD_A_TIT}', CONFIG?.produtoA?.titulo || '')
    .replaceAll('{PROD_A_PRECO}', CONFIG?.produtoA?.preco || '')
    .replaceAll('{PROD_B_TIT}', CONFIG?.produtoB?.titulo || '')
    .replaceAll('{PROD_B_PRECO}', CONFIG?.produtoB?.preco || '');
}

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
    const rel = `/uploads/${req.file.filename}`;
    const base = (process.env.APP_BASE_URL || '').replace(/\/+$/,'');
    const abs  = base ? `${base}${rel}` : null;
    return res.json({ ok: true, url: rel, absolute_url: abs, filename: req.file.filename });
  } catch (e) {
    console.error('[UPLOAD]', e);
    return res.status(500).json({ ok: false, error: 'Falha no upload' });
  }
});
// ============================================================================

// ---------- CONFIG persistente ----------
const CONFIG_PATH = path.join(__dirname, 'config.json');

let CONFIG = {
  titulo: 'Lista de Fornecedores de Atacado',
  texto: 'Receba a lista completa imediatamente após o pagamento.',
  preco: 'R$ 19,90',
  whatsapp_suporte: '+5565984361007',
  checkout_url: 'https://pay.cakto.com.br/SEU_LINK?orderId={ORDER_ID}',

  saudacao:
    'Olá, {NAME}! 👋\n\n' +
    'Tenho duas opções pra você:\n' +
    'A) {PROD_A_TIT} — {PROD_A_PRECO}\n' +
    'B) {PROD_B_TIT} — {PROD_B_PRECO}\n\n' +
    'Toque no botão ou digite A ou B.\n' +
    '(Se os botões não aparecerem, digite A ou B).',

  produtoA: {
    rotulo: 'Produto A',
    titulo: 'Lista de Fornecedores Premium',
    preco: 'R$ 19,90',
    checkout_url: 'https://pay.cakto.com.br/SEU_LINK_A?orderId={ORDER_ID}',
    cover_url: '',
    bumps: [],
    entrega: { pdf_url:'', video_url:'', link_url:'' }
  },

  produtoB: {
    rotulo: 'Produto B',
    titulo: 'Lista com Contatos Extras',
    preco: 'R$ 29,90',
    checkout_url: 'https://pay.cakto.com.br/SEU_LINK_B?orderId={ORDER_ID}',
    cover_url: '',
    bumps: [],
    entrega: { pdf_url:'', video_url:'', link_url:'' }
  },
};

try {
  if (fs.existsSync(CONFIG_PATH)) {
    CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
} catch (e) {
  console.error('Falha ao ler config.json:', e);
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG, null, 2));
}

// ======== CAMPANHAS: storage simples ========
const LEADS_PATH = path.join(__dirname, 'leads.json');
const CAMPAIGNS_PATH = path.join(__dirname, 'campaigns.json');

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJsonSafe(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// estruturas em memória + persistência
let LEADS = readJsonSafe(LEADS_PATH, []);        // [{ wa_id, name, last_incoming_at, last_outgoing_at, comprou, opt_in_marketing }]
let CAMPAIGNS = readJsonSafe(CAMPAIGNS_PATH, []); // [{ id, name, created_at, start_at, status, filter, policy, content, stats, queue }]

function saveLeads() { writeJsonSafe(LEADS_PATH, LEADS); }
function saveCampaigns() { writeJsonSafe(CAMPAIGNS_PATH, CAMPAIGNS); }

// normaliza telefone em E.164 (assume Brasil quando vier só dígitos)
function normPhone(raw='') {
  const d = String(raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55')) return '+' + d;
  if (d.length === 11) return '+55' + d;  // ex: 65999999999
  if (d.length === 13 && d.startsWith('55')) return '+' + d;
  return '+' + d; // fallback
}

// ---------- Helpers & Sessão ----------
const sessions = new Map(); // memória volátil
const ORDERS   = new Map(); // orderId -> { to, productKey, createdAt }
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
  theUrl = String(prod.checkout_url || '').trim();
  return theUrl.replace('{ORDER_ID}', orderId);
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// =================== MERCADO PAGO (Payments/Checkout Pro) ====================
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const mpClient = process.env.MP_ACCESS_TOKEN
  ? new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
  : null;
const NOTIFY = ((process.env.APP_BASE_URL || '').replace(/\/+$/, '')) + '/mp/webhook';

function parsePriceBR(precoStr, fallback = 0) {
  if (!precoStr) return fallback;
  const n = String(precoStr).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const v = Number(n);
  return isNaN(v) ? fallback : v;
}

function computeAmountBRL(productKey, flags = {}) {
  const prod = CONFIG[`produto${productKey}`] || {};
  let total = parsePriceBR(prod.preco, 0);

  const list = Array.isArray(prod.bumps) ? prod.bumps : [];
  list.forEach(b => {
    if (b && (flags[b.id] || flags[String(b.id)])) {
      total += parsePriceBR(b.preco, 0);
    }
  });

  return Math.round((Number(total) || 0) * 100) / 100;
}

function absolutize(url) {
  url = String(url || '').trim();
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  if (!base) return url;
  return url.startsWith('/') ? base + url : `${base}/${url}`;
}

/** Soma produto + bumps selecionados (flags = {b1:true,...}) */
function calcTotalAmount(productKey, flags = {}) {
  const prod = CONFIG[`produto${productKey}`] || {};
  let total = parsePriceBR(prod.preco, 0);
  const bumps = Array.isArray(prod.bumps) ? prod.bumps : [];
  bumps.forEach(b => {
    if (b?.id && flags[b.id]) total += parsePriceBR(b.preco, 0);
  });
  return Number(total.toFixed(2));
}

async function createMPPreferenceForProduct(productKey, orderId) {
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
    notification_url: `${base}/mp/webhook`
  };

  const pref = new Preference(mpClient);
  const resp = await pref.create({ body: preference });
  const init = resp?.init_point || resp?.sandbox_init_point || resp?.body?.init_point || resp?.body?.sandbox_init_point;
  if (!init) throw new Error('Não foi possível obter init_point do Mercado Pago.');
  return { init_point: init, pref_id: resp?.body?.id || '' };
}

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

/**
 * POST /mp/process-payment
 * - Formato 1 (Bricks): { transaction_amount, token, payment_method_id, ... }
 * - Formato 2 (leve do seu front): { orderId, productKey, method: 'pix'|'boleto'|'card', bumps: {b1:true,...} }
 */
app.post('/mp/process-payment', async (req, res) => {
  try {
    if (!mpClient) {
      return res.status(400).json({ ok:false, error:'MP_ACCESS_TOKEN ausente' });
    }

    const mpPayment = new Payment(mpClient);

    // === Caminho 2: requisição leve vinda do seu checkout embutido ===
if (req.body && req.body.method) {
  const methodRaw  = String(req.body.method || '').toLowerCase();
  const method     = ['pix','boleto','card'].includes(methodRaw) ? methodRaw : 'pix';
  const productKey = String(req.body.productKey || 'A').toUpperCase() === 'B' ? 'B' : 'A';
  const orderId    = req.body.orderId || makeOrderId();
  const flags      = req.body.bumps || {};
  const amount     = calcTotalAmount(productKey, flags);
  const title      = (CONFIG[`produto${productKey}`]?.titulo) || `Produto ${productKey}`;

  const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  const NOTIFY  = baseUrl ? `${baseUrl}/mp/webhook` : undefined;

  if (!(amount > 0)) {
    return res.status(400).json({ ok:false, error:'transaction_amount attribute can\'t be null' });
  }

  // ===== CARTÃO =====
  if (method === 'card') {
    const c = req.body?.card || {};
    if (!c.token) {
      return res.status(400).json({ ok:false, error:'Token do cartão ausente' });
    }

    const clientIp =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress || undefined;

    const installments = Math.max(1, Number(c.installments) || 1);

    const body = {
      transaction_amount: Number(amount),
      description: title,
      token: c.token,
      installments,
      external_reference: orderId,
      binary_mode: true,
      capture: true,
      notification_url: NOTIFY,
      payer: {
        email: c?.payer?.email || req.body?.email || 'compras@example.com',
        identification: {
          type: (c?.payer?.identification?.type || 'CPF'),
          number: String(c?.payer?.identification?.number || '').replace(/\D+/g,'')
        },
        first_name: c?.payer?.first_name || undefined,
        last_name:  c?.payer?.last_name  || undefined,
        address: c?.payer?.address ? {
          zip_code:      c.payer.address.zip_code      ?? c.payer.address.zipCode      ?? undefined,
          street_name:   c.payer.address.street_name   ?? c.payer.address.streetName   ?? undefined,
          street_number: c.payer.address.street_number ?? c.payer.address.streetNumber ?? c.payer.address.number ?? undefined,
          neighborhood:  c.payer.address.neighborhood  ?? c.payer.address.bairro       ?? undefined,
          city:          c.payer.address.city          ?? c.payer.address.cidade       ?? undefined,
          federal_unit:  c.payer.address.federal_unit  ?? c.payer.address.state        ?? c.payer.address.uf ?? undefined,
        } : undefined,
      },
      additional_info: {
        ip_address: clientIp,
        items: [{ id:`PROD-${productKey}`, title, quantity:1, unit_price:Number(amount) }],
        payer: {
          first_name: c?.payer?.first_name || 'Cliente',
          last_name:  c?.payer?.last_name  || 'Site',
          registration_date: new Date().toISOString().slice(0,10)
        }
      },
      metadata: { orderId, productKey }
    };

    Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
    if (body.payer && body.payer.address) {
      Object.keys(body.payer.address).forEach(k => body.payer.address[k] === undefined && delete body.payer.address[k]);
    }

    try {
      const resp = await mpPayment.create({ body });
      const p = resp?.body || resp;
      return res.json({ ok:true, method:'card', status:p?.status, status_detail:p?.status_detail, payment:p });
    } catch (e) {
      const err = e?.response?.data || e.message;
      return res.status(400).json({ ok:false, error: err });
    }
  }

  // ===== PIX =====
  if (method === 'pix') {
    const body = {
      transaction_amount: Number(amount),
      description: title,
      payment_method_id: 'pix',
      external_reference: orderId,
      payer: { email: req.body?.payer?.email || 'compras@example.com' },
      binary_mode: true,
      notification_url: NOTIFY,
      metadata: { orderId, productKey }
    };

    const resp = await mpPayment.create({ body });
    const p = resp?.body || resp;
    const td = p?.point_of_interaction?.transaction_data || {};

    return res.json({
      ok: true,
      method: 'pix',
      id: p?.id,
      status: p?.status,
      status_detail: p?.status_detail,
      pix: {
        copia_e_cola: td?.qr_code || null,
        qr_base64: td?.qr_code_base64 || null
      }
    });
  }

  // ===== BOLETO =====
  if (method === 'boleto') {
    const boleto  = req.body?.boleto || {};
    const rawName = String(boleto.name || '').trim() || 'Cliente Teste';
    const cpf     = String(boleto.cpf  || '').replace(/\D+/g, '');
    const email   = String(boleto.email|| '').trim() || 'compras@example.com';

    const a = boleto.address || {};
    const address = {
      zip_code:      (a.zip_code ?? a.zipCode ?? '').toString().replace(/\D+/g, ''),
      street_name:   (a.street_name ?? a.streetName ?? '').toString().trim(),
      street_number: (a.street_number ?? a.streetNumber ?? a.number ?? '').toString().trim(),
      neighborhood:  (a.neighborhood ?? a.bairro ?? '').toString().trim(),
      city:          (a.city ?? a.cidade ?? '').toString().trim(),
      federal_unit:  (a.federal_unit ?? a.state ?? a.uf ?? '').toString().toUpperCase().trim()
    };

    if (!cpf || cpf.length !== 11) {
      return res.status(400).json({ ok:false, error:'CPF inválido (use 11 dígitos)' });
    }

    const txAmount = Number(amount);
    if (!(txAmount >= 3)) {
      return res.status(400).json({ ok:false, error:'Valor mínimo para boleto é R$ 3,00' });
    }

    const parts = rawName.split(/\s+/).filter(Boolean);
    const first_name = parts.length ? parts[0] : 'Cliente';
    const last_name  = parts.length > 1 ? parts.slice(1).join(' ') : 'Teste';

    const missing = [];
    if (!address.zip_code || address.zip_code.length < 8) missing.push('payer.address.zip_code');
    if (!address.street_name)   missing.push('payer.address.street_name');
    if (!address.street_number) missing.push('payer.address.street_number');
    if (!address.neighborhood)  missing.push('payer.address.neighborhood');
    if (!address.city)          missing.push('payer.address.city');
    if (!address.federal_unit || address.federal_unit.length !== 2) missing.push('payer.address.federal_unit (UF)');

    if (missing.length) {
      return res.status(400).json({ ok:false, error:'Endereço do pagador incompleto para boleto', required: missing, received: address });
    }

    const body = {
      transaction_amount: txAmount,
      description: title,
      payment_method_id: 'bolbradesco',
      external_reference: orderId,
      binary_mode: false,
      notification_url: NOTIFY,
      payer: {
        email,
        first_name,
        last_name,
        identification: { type: 'CPF', number: cpf },
        address: {
          zip_code: address.zip_code,
          street_name: address.street_name,
          street_number: address.street_number,
          neighborhood: address.neighborhood,
          city: address.city,
          federal_unit: address.federal_unit
        }
      },
      metadata: { orderId, productKey }
    };

    const resp = await mpPayment.create({ body });
    const p = resp?.body || resp;
    const link =
      p?.transaction_details?.external_resource_url ||
      p?.point_of_interaction?.transaction_data?.ticket_url || null;

    return res.json({
      ok: true,
      method: 'boleto',
      id: p?.id,
      status: p?.status,
      status_detail: p?.status_detail,
      boleto: { ticket_url: link, barcode: p?.barcode || p?.barcode_content || null },
      payment: p
    });
  }

  // encerra o "caminho 2"
  return;
}


    // === Caminho 1: BRICKS (compatibilidade) ===
    const {
      transaction_amount,
      description,
      payment_method_id,
      token,
      installments,
      issuer_id,
      payer
    } = req.body || {};

    const body = {
      transaction_amount: Number(transaction_amount),
      description: description || 'Pedido',
      payment_method_id,
      token,
      installments: installments ? Number(installments) : undefined,
      issuer_id,
      payer,
      binary_mode: true,
      external_reference: req.body?.external_reference || req.body?.metadata?.orderId || null,
      notification_url: `${(process.env.APP_BASE_URL || '').replace(/\/+$/,'')}/mp/webhook`,
      metadata: {
        orderId: req.body?.metadata?.orderId || null,
        productKey: req.body?.metadata?.productKey || null,
      }
    };
    Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

    const resp = await mpPayment.create({ body });
    const p = resp?.body || resp;

    return res.json({ ok: true, id: p?.id, status: p?.status, status_detail: p?.status_detail });

  } catch (e) {
    console.error('[MP process-payment]', e?.response?.data || e.message);
    return res.status(400).json({ ok:false, error: e?.response?.data || e.message });
  }
});

app.get('/mp/checkout', async (req, res) => {
  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(400).send('Config ausente: MP_ACCESS_TOKEN');
    }
    const productKey = String(req.query.product || 'A').toUpperCase() === 'B' ? 'B' : 'A';
    const orderId = req.query.orderId || makeOrderId();
    const { init_point } = await createMPPreferenceForProduct(productKey, orderId);
    return res.redirect(init_point);
  } catch (e) {
    console.error('[MP checkout]', e?.response?.data || e.message);
    return res.status(500).send('Falha ao redirecionar para Mercado Pago');
  }
});

// ===== Mercado Pago webhook: envia entrega quando APROVADO =====
async function handleMpWebhook(req, res) {
  res.sendStatus(200);
  try {
    if (!process.env.MP_ACCESS_TOKEN || !mpClient) return;

    // 1) Captura id do pagamento em TODOS os formatos possíveis
    const body = req.body || {};
    const query = req.query || {};
    const topic  = (body.topic || query.topic || body.type || query.type || '').toString().toLowerCase();

    let id =
      body?.data?.id ??
      query?.['data.id'] ?? query?.data_id ??
      body?.resource  ??
      query?.resource ??
      body?.id ?? query?.id ?? null;

    if (typeof id === 'string') {
      const m = id.match(/(\d{6,})$/);
      if (m) id = m[1];
    }

    if (topic !== 'payment' || !id) {
      console.log('[MP WEBHOOK] ignorado:', body || query);
      return;
    }

    // 2) Carrega o pagamento
    const payment = new Payment(mpClient);
    const p = await payment.get({ id });

    const status = (p.status || '').toLowerCase();
    console.log('[MP WEBHOOK] payment', id, 'status=', status, 'detail=', p.status_detail);
    if (status !== 'approved') {
      console.log('[MP WEBHOOK] pagamento não aprovado ainda:', p.status);
      return;
    }

    // 3) Atualiza dashboard (sempre que aprovado) — com DEDUPE
    try {
      const paymentId = String(p.id || '').trim();
      const orderId   = p.metadata?.orderId || null;

      if (alreadyLoggedPayment(paymentId, orderId)) {
        console.log('[MP WEBHOOK] compra já registrada para', paymentId || orderId);
      } else {
        const productKeyMd = (p.metadata?.productKey || '').toUpperCase();
        const key = productKeyMd === 'B' ? 'B' : 'A';

        const amount =
          Number(p.transaction_amount) ||
          Number(p.amount) ||
          Number(p?.additional_info?.items?.[0]?.unit_price) ||
          parseFloat(String(CONFIG[`produto${key}`]?.preco || '0').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.')) ||
          0;

        logEventSafe({
          type: 'purchase',
          payment_id: paymentId || null,
          orderId,
          productKey: key,
          amount
        });
      }
    } catch (e) {
      console.warn('[MP WEBHOOK] falhou ao registrar analytics:', e.message);
    }

    // 4) Tenta entregar por WhatsApp (opcional, só se soubermos o número)
    const orderId = p.metadata?.orderId;
    const cached  = orderId ? ORDERS.get(orderId) : null;
    const to      = cached?.to;
    const key     = ((p.metadata?.productKey || cached?.productKey) === 'B') ? 'B' : 'A';

    if (!to) {
      console.warn('[MP WEBHOOK] não achei o número do cliente para orderId:', orderId);
      return; // sem número, não dá pra enviar entrega — mas a venda já foi contabilizada
    }

    // marca contato como comprador
    try {
      if (!CONTACTS[to]) CONTACTS[to] = { name: '', lastSeen: 0, purchased: false };
      CONTACTS[to].lastSeen = Date.now();
      CONTACTS[to].purchased = true;
      saveContacts();
    } catch (e) {
      console.warn('[MP WEBHOOK] falhou ao salvar contato (purchased=true):', e.message);
    }

    // envia os itens de entrega
    const prod   = CONFIG[`produto${key}`] || {};
    const ent    = prod.entrega || {};
    const titulo = prod.titulo || `Produto ${key}`;

    await sendText({
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      to,
      body: `✅ Pagamento aprovado!\n\n📦 ${titulo}\nObrigado pela compra! Abaixo estão os seus acessos/arquivos.`
    });

    if (ent.pdf_url) {
      await sendDocument({
        token: process.env.WHATSAPP_TOKEN,
        phoneNumberId: process.env.PHONE_NUMBER_ID,
        to,
        url: ent.pdf_url,
        filename: `${(titulo || 'arquivo').replace(/\s+/g,'_')}.pdf`
      });
    }

    if (ent.video_url) {
      if (/\.(mp4|mov|m4v)$/i.test(ent.video_url)) {
        await sendVideo({
          token: process.env.WHATSAPP_TOKEN,
          phoneNumberId: process.env.PHONE_NUMBER_ID,
          to,
          url: ent.video_url,
          caption: `🎬 Vídeo do ${titulo}`
        });
      } else {
        await sendText({
          token: process.env.WHATSAPP_TOKEN,
          phoneNumberId: process.env.PHONE_NUMBER_ID,
          to,
          body: `🎬 Acesse o vídeo: ${ent.video_url}`
        });
      }
    }

    if (ent.link_url) {
      await sendText({
        token: process.env.WHATSAPP_TOKEN,
        phoneNumberId: process.env.PHONE_NUMBER_ID,
        to,
        body: `🔗 Link de acesso: ${ent.link_url}`
      });
    }

    if (CONFIG.whatsapp_suporte) {
      await sendText({
        token: process.env.WHATSAPP_TOKEN,
        phoneNumberId: process.env.PHONE_NUMBER_ID,
        to,
        body: `Qualquer dúvida, fale com o suporte: ${CONFIG.whatsapp_suporte}`
      });
    }

    if (orderId) ORDERS.delete(orderId);
  } catch (e) {
    console.error('[MP WEBHOOK] erro:', e?.response?.data || e.message);
  }
}
app.post('/mp/webhook', handleMpWebhook);
app.get('/mp/webhook',  handleMpWebhook);

async function sendGreeting(to, name) {
  const body = buildGreeting(name);

  await sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body,
  });

  await sendText({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    to,
    body: '(Se os botões não aparecerem no WhatsApp Web/PC, responda com A, B ou MENU.)',
  });

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

async function sendOffer(to, product, orderId) {
  let link;
  const urlTpl = String(product?.checkout_url || '').trim();
  if (urlTpl.startsWith('mp:')) {
    try {
      const keyGuess = (product === CONFIG.produtoB) ? 'B' : 'A';
      const { init_point } = await createMPPreferenceForProduct(keyGuess, orderId);
      link = init_point;
    } catch (e) {
      console.error('[sendOffer] MP error:', e?.response?.data || e.message);
      link = buildCheckoutUrl(urlTpl, orderId);
    }
  } else {
    link = buildCheckoutUrl(urlTpl, orderId);
  }

  const productKey = (product === CONFIG.produtoB) ? 'B' : 'A';
  ORDERS.set(orderId, { to, productKey, createdAt: Date.now() });

  const title   = product?.titulo || 'Oferta';
  const price   = product?.preco  || '';
  const suporte = CONFIG.whatsapp_suporte || '';

  const body =
    `📦 ${title}\n` +
    (price ? `💰 Preço: ${price}\n\n` : '\n') +
    `🧾 Pedido: ${orderId}\n` +
    (link  ? `👉 Pague no link seguro:\n${link}\n\n` : '\n') +
    (suporte ? `📞 Suporte: ${suporte}` : '');

  await sendText({ token: process.env.WHATSAPP_TOKEN, phoneNumberId: process.env.PHONE_NUMBER_ID, to, body });
  await sendText({ token: process.env.WHATSAPP_TOKEN, phoneNumberId: process.env.PHONE_NUMBER_ID, to, body: '(Para voltar ao menu, digite: MENU)' });

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

async function sendDefaultOneProduct(to) {
  const orderId = makeOrderId();
  const link = buildCheckoutUrl(CONFIG.checkout_url, orderId);

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

// helper para normalizar URLs de /uploads
function toRelativeUploads(u) {
  let s = String(u || '').trim();
  if (!s) return s;
  if (s.startsWith('/uploads/')) return s;

  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/,'');
  if (base && s.startsWith(base + '/uploads/')) return s.slice(base.length);

  const m = s.match(/^https?:\/\/[^\/]+(\/uploads\/.+)$/i);
  if (m) return m[1];

  return s;
}

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
      if (patch.produtoA.cover_url !== undefined) {
        CONFIG.produtoA.cover_url = toRelativeUploads(patch.produtoA.cover_url);
      }
      if (patch.produtoA.entrega) {
        CONFIG.produtoA.entrega = { ...(CONFIG.produtoA.entrega||{}) };
        ['pdf_url','video_url','link_url'].forEach(k => assignIf(CONFIG.produtoA.entrega, k, patch.produtoA.entrega[k]));
      }
      if (Array.isArray(patch.produtoA.bumps)) {
        CONFIG.produtoA.bumps = patch.produtoA.bumps.map(b => ({ ...b, img_url: toRelativeUploads(b?.img_url) }));
      }
    }
    if (patch.produtoB) {
      CONFIG.produtoB = { ...CONFIG.produtoB };
      ['rotulo','titulo','preco','checkout_url'].forEach(k => assignIf(CONFIG.produtoB, k, patch.produtoB[k]));
      if (patch.produtoB.cover_url !== undefined) {
        CONFIG.produtoB.cover_url = toRelativeUploads(patch.produtoB.cover_url);
      }
      if (patch.produtoB.entrega) {
        CONFIG.produtoB.entrega = { ...(CONFIG.produtoB.entrega||{}) };
        ['pdf_url','video_url','link_url'].forEach(k => assignIf(CONFIG.produtoB.entrega, k, patch.produtoB.entrega[k]));
      }
      if (Array.isArray(patch.produtoB.bumps)) {
        CONFIG.produtoB.bumps = patch.produtoB.bumps.map(b => ({ ...b, img_url: toRelativeUploads(b?.img_url) }));
      }
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

// === Analytics simples (com dedupe) =========================================
const ANALYTICS_PATH = path.join(__dirname, 'analytics.json');
function readJsonSafe2(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }
function writeJsonSafe2(p, v){ fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

let ANALYTICS = readJsonSafe2(ANALYTICS_PATH, []); // [{ts, type, payment_id?, orderId?, productKey?, wa_id?, amount?}]

function alreadyLoggedPayment(paymentId, orderId){
  if (paymentId && ANALYTICS.some(e => e.type === 'purchase' && e.payment_id === paymentId)) return true;
  if (orderId   && ANALYTICS.some(e => e.type === 'purchase' && e.orderId    === orderId))   return true;
  return false;
}

function logEvent(ev){
  ev = { ts: Date.now(), ...ev };
  ANALYTICS.push(ev);
  writeJsonSafe2(ANALYTICS_PATH, ANALYTICS);
}

// só grava compra se não for duplicada
function logEventSafe(ev){
  if (ev?.type === 'purchase'){
    const pid = ev.payment_id || null;
    const oid = ev.orderId || null;
    if (alreadyLoggedPayment(pid, oid)) return;
  }
  logEvent(ev);
}

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

      // ======== CAMPANHAS: upsert lead a cada mensagem recebida ========
      try {
        const wa_id = normPhone(msg.from);
        if (wa_id) {
          const nowIso = new Date().toISOString();
          let lead = LEADS.find(l => l.wa_id === wa_id);
          if (!lead) {
            lead = { wa_id, name, last_incoming_at: nowIso, last_outgoing_at: null, comprou: false, opt_in_marketing: true };
            LEADS.push(lead);
          } else {
            lead.name = name || lead.name;
            lead.last_incoming_at = nowIso;
          }
          saveLeads();
        }
      } catch(e) { console.error('[LEADS upsert]', e.message); }

      // --- analytics: marca uma mensagem recebida desse contato
      try {
        const wa_id_norm = normPhone(msg.from);
        if (wa_id_norm) logEvent({ type: 'message_in', wa_id: wa_id_norm });
      } catch {}

      if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
        const payload = String(msg.interactive.button_reply.id || '').toUpperCase();
        if (payload === 'CHOOSE_A') { const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoA, orderId); return; }
        if (payload === 'CHOOSE_B') { const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoB, orderId); return; }
        if (payload === 'MENU')     { s.stage = 'waiting_choice'; await sendGreeting(to, name); return; }
      }

      if (msg.type === 'button' && msg?.button?.payload) {
        const payload = String(msg.button.payload || '').toUpperCase();
        if (payload === 'CHOOSE_A') { const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoA, orderId); return; }
        if (payload === 'CHOOSE_B') { const orderId = makeOrderId(); await sendOffer(to, CONFIG.produtoB, orderId); return; }
        if (payload === 'MENU')     { s.stage = 'waiting_choice'; await sendGreeting(to, name); return; }
      }

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

// ======= ROTAS DE ANALYTICS ================================================
app.post('/analytics/checkout-click', (req, res) => {
  try {
    const orderId = (req.body?.orderId || '').toString().slice(0,64);
    const productKey = (req.body?.productKey === 'B' ? 'B' : 'A');
    logEvent({ type: 'checkout_click', orderId, productKey });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[analytics click]', e.message);
    return res.status(500).json({ ok:false });
  }
});

function _ymd(ts){ return new Date(ts).toISOString().slice(0,10); }

app.get('/analytics/stats', (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from + 'T00:00:00') : new Date(Date.now() - 6*864e5);
    const to   = req.query.to   ? new Date(req.query.to   + 'T23:59:59') : new Date();

    const inRange = ev => {
      const t = new Date(ev.ts || 0);
      return t >= from && t <= to;
    };

    const evs = ANALYTICS.filter(inRange);

    // --- dedupe de purchases por payment_id (fallback: orderId)
    const uniqKey = e => e.payment_id || (`ORD:${e.orderId||''}`);
    const seen = new Set();
    const uniquePurchases = [];
    evs.forEach(e => {
      if (e.type !== 'purchase') return;
      const k = uniqKey(e);
      if (!seen.has(k)) { seen.add(k); uniquePurchases.push(e); }
    });

    const totalClicks = evs.filter(e => e.type === 'checkout_click').length;
    const totalSales  = uniquePurchases.length;
    const revenue     = uniquePurchases.reduce((s,e)=> s + (Number(e.amount)||0), 0);

    const uniqMsgSet = new Set();
    evs.forEach(e => { if (e.type==='message_in' && e.wa_id) uniqMsgSet.add(e.wa_id); });

    const dailyMap = new Map();
    const bump = (d, k, v=1) => {
      if (!dailyMap.has(d)) dailyMap.set(d, { date:d, checkout_clicks:0, unique_msg_in:0, sales_count:0 });
      dailyMap.get(d)[k] += v;
    };

    // clicks por dia
    evs.forEach(e => { if (e.type === 'checkout_click') bump(_ymd(e.ts), 'checkout_clicks'); });

    // vendas por dia (únicas)
    uniquePurchases.forEach(e => { bump(_ymd(e.ts), 'sales_count'); });

    // mensagens únicas por dia
    const seenDayWa = new Set();
    evs.forEach(e => {
      if (e.type==='message_in' && e.wa_id){
        const key = _ymd(e.ts)+'|'+e.wa_id;
        if (!seenDayWa.has(key)){ seenDayWa.add(key); bump(_ymd(e.ts), 'unique_msg_in'); }
      }
    });

    const daily = Array.from(dailyMap.values()).sort((a,b)=> a.date.localeCompare(b.date));

    res.json({
      ok: true,
      totals: {
        checkout_clicks: totalClicks,
        unique_msg_in: uniqMsgSet.size,
        sales_count: totalSales,
        revenue
      },
      daily
    });
  } catch (e) {
    console.error('[analytics/stats]', e.message);
    res.status(500).json({ ok:false });
  }
});

// ---------- Start ----------
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Servidor WhatsApp rodando na porta ${PORT}`));
