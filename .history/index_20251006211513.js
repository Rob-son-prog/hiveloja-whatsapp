// index.js
require('dotenv').config();
const express = require('express');
const { sendText } = require('./phone');

const app = express();
app.use(express.json());
const fs = require('fs');
const path = require('path');

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
} catch (e) { console.error('Falha ao ler config.json:', e); }

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
app.post('/webhook', async (req, res) => {
  try {
    // 1) SEMPRE responde 200 rápido pra Meta
    res.sendStatus(200);

    const body = req.body;
    console.log('[WEBHOOK] body:', JSON.stringify(body, null, 2));

    // 2) valida estrutura WABA e puxa value/msg
    if (!(body.object === 'whatsapp_business_account' &&
          Array.isArray(body.entry) &&
          body.entry[0]?.changes?.[0]?.value?.messages?.length)) {
      return;
    }

    const value = body.entry[0].changes[0].value;
    const msg = value.messages[0];
    if (!msg || !msg.from) return;

    // 3) ignora eco do próprio WABA
    const myWaba = value?.metadata?.phone_number_id;
    if (String(msg.from) === String(myWaba)) {
      console.log('[WEBHOOK] eco da própria mensagem — ignorando');
      return;
    }

    const to = `+${msg.from}`;

    // ===============================
    // 4) GATILHOS DE VENDA (usa CONFIG do painel)
    // ===============================
    if (msg.type === 'text') {
      const textIn = (msg.text?.body || '').trim().toLowerCase();

      const gatilhos = [
        'menu','oi','olá','ola',
        'lista','fornecedor','fornecedores',
        'comprar','preço','preco','valor'
      ];

      if (gatilhos.some(k => textIn.includes(k))) {
        const orderId = makeOrderId();                 // helper que você colou acima
        sessions.set(msg.from, { orderId, createdAt: Date.now() }); // memória simples

        const link = buildCheckoutUrl(orderId);        // usa {ORDER_ID} do painel

        const resposta =
          `🛍️ ${CONFIG.titulo}\n` +
          `${CONFIG.texto}\n\n` +
          `💰 Preço: ${CONFIG.preco}\n\n` +
          `👉 Pague no link seguro:\n${link}\n\n` +
          `📞 Suporte: ${CONFIG.whatsapp_suporte}`;

        await sendText({
          token: process.env.WHATSAPP_TOKEN,
          phoneNumberId: process.env.PHONE_NUMBER_ID,
          to,
          body: resposta
        });
        return; // já respondemos ao cliente
      }
    }

    // 5) (opcional) fallback: eco simples do que o cliente escreveu
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
    // não reenvia resposta aqui (já enviamos 200 no começo)
  }
});

// (removemos o check de 'wamid' porque o payload de teste não usa esse prefixo)

        

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
