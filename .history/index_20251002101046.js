// index.js
// Servidor WhatsApp Cloud API — Webhook + envio de mensagem de texto
import express from "express";
import axios from "axios";
import "dotenv/config";
import { toE164BR } from "./phone.js";

// ================== APP & MIDDLEWARE ==================
const app = express();
app.use(express.json());

// ================== ENV ==================
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;     // defina algo e use igual no painel Meta
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // token Bearer
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // ID do número no WhatsApp Business

// ================== UTIL: ENVIAR TEXTO ==================
async function sendText(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  try {
    const { data } = await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to, // número do cliente em E.164
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        },
      }
    );
    return data;
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err?.response?.data || err.message);
    throw err;
  }
}

// ================== ROTAS ==================

// 0) Normalizador (teste rápido, não chama a API do WhatsApp)
app.get("/normalize", (req, res) => {
  const { to } = req.query;
  if (!to) return res.status(400).json({ error: "Informe ?to=..." });
  const toE164 = toE164BR(String(to), "65");
  res.json({ input: to, normalized: toE164 });
});

// 1) Rota de teste: normaliza e tenta enviar texto
app.get("/send-test", async (req, res) => {
  try {
    const { to, text = "Teste ok!" } = req.query;
    if (!to) return res.status(400).json({ error: "Informe ?to=..." });
    const toE164 = toE164BR(String(to), "65"); // força DDD 65 por padrão
    const data = await sendText(toE164, String(text));
    res.json({ ok: true, to: toE164, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

// 2) Verificação de Webhook (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado com sucesso!");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// 3) Recebimento de mensagens (POST)
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const from = message.from;
      const type = message.type;
      const isFromCustomer = !message?.from_me;

      if (isFromCustomer) {
        if (type === "text") {
          const userText = message.text.body?.trim() || "";
          if (/^menu$/i.test(userText)) {
            await sendText(
              from,
              "🍰 *Cardápio HiveLoja*\n\n1) Bolo Japonês — R$19,90\n2) Top 5 Receitas — R$29,90\n\nResponda com o número do item para receber o link de pagamento."
            );
          } else if (/^(1|2)$/.test(userText)) {
            const links = {
              "1": "https://pay.cakto.com.br/b3fsmoi",
              "2": "https://pay.cakto.com.br/7mkph63_391237",
            };
            await sendText(
              from,
              `Perfeito! ✅\nSeu link de pagamento é:\n${links[userText]}\n\nAssim que o pagamento for aprovado, envio o arquivo automaticamente aqui no WhatsApp.`
            );
          } else {
            await sendText(
              from,
              "Oi! Eu sou o assistente da *HiveLoja*. Envie *menu* para ver nossas ofertas. 😉"
            );
          }
        } else {
          await sendText(from, "Recebi sua mensagem! Envie *menu* para começar. 🙂");
        }
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err?.response?.data || err.message);
    return res.sendStatus(200);
  }
});

// ================== START ==================
app.listen(PORT, () => {
  console.log(`Servidor WhatsApp rodando na porta ${PORT}`);
});
