// index.js
// Servidor WhatsApp Cloud API — Webhook + envio de mensagem de texto
// Requisitos (vamos instalar no próximo passo): express, dotenv, axios

import express from "express";
import axios from "axios";
import "dotenv/config";
import { toE164BR } from "./phone.js";

// ...

app.get("/send-test", async (req, res) => {
  try {
    const { to, text = "Teste ok!" } = req.query;
    if (!to) return res.status(400).json({ error: "Informe ?to=..." });
    const toE164 = toE164BR(String(to), "65"); // força DDD 65 como padrão
    const data = await sendText(toE164, String(text));
    res.json({ ok: true, to: toE164, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

const app = express();
app.use(express.json());

// Variáveis de ambiente (vamos criar o .env no próximo passo)
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;           // defina algo como: minhachavesecreta
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;       // token do WhatsApp Cloud API (Bearer)
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;     // ID do número no WhatsApp Business (ex: 123456789012345)

// Utilitário para enviar texto pelo WhatsApp Cloud API
async function sendText(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  try {
    const { data } = await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to, // número do cliente no formato E.164 (ex: "5511999999999")
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

/**
 * GET /webhook
 * Endpoint de verificação exigido pelo Meta/WhatsApp ao configurar o webhook.
 * No painel, você define o VERIFY_TOKEN (o mesmo do .env).
 */
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

/**
 * POST /webhook
 * Recebe notificações de mensagens. Aqui tratamos mensagens de texto e respondemos.
 */
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // Estrutura padrão de entrada do WhatsApp
    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const from = message.from; // exemplo: "5511999999999"
      const type = message.type;

      // Apenas para evitar loop com mensagens do próprio sistema
      const isFromCustomer = !message?.from_me;

      if (isFromCustomer) {
        if (type === "text") {
          const userText = message.text.body?.trim() || "";

          // Regras simples de demo (vamos melhorar depois para fluxo de vendas)
          if (/^menu$/i.test(userText)) {
            await sendText(
              from,
              "🍰 *Cardápio HiveLoja*\n\n1) Bolo Japonês — R$19,90\n2) Top 5 Receitas — R$29,90\n\nResponda com o número do item para receber o link de pagamento."
            );
          } else if (/^(1|2)$/.test(userText)) {
            // Aqui você pode trocar pelos seus links reais (Cakto, Mercado Pago, etc.)
            const links = {
              "1": "https://pay.cakto.com.br/b3fsmoi", // exemplo: Bolo Japonês
              "2": "https://pay.cakto.com.br/7mkph63_391237", // exemplo: Top 5 Receitas
            };
            await sendText(
              from,
              `Perfeito! ✅\nSeu link de pagamento é:\n${links[userText]}\n\nAssim que o pagamento for aprovado, envio o arquivo automaticamente aqui no WhatsApp.`
            );
          } else {
            // Mensagem padrão
            await sendText(
              from,
              "Oi! Eu sou o assistente da *HiveLoja* no WhatsApp. Envie *menu* para ver nossas ofertas. 😉"
            );
          }
        } else {
          // Outros tipos (imagem, áudio, etc.). Vamos tratar em passos futuros.
          await sendText(from, "Recebi sua mensagem! Envie *menu* para começar. 🙂");
        }
      }
    }

    // WhatsApp exige 200 OK rápido
    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err?.response?.data || err.message);
    return res.sendStatus(200); // ainda responde 200 para evitar reenvio
  }
});

/**
 * Rota de teste local para disparar uma mensagem manualmente (útil durante o dev):
 * GET /send-test?to=5511999999999&text=Oi
 */
app.get("/send-test", async (req, res) => {
  try {
    const { to, text = "Teste ok!" } = req.query;
    if (!to) return res.status(400).json({ error: "Informe ?to=5511xxxxxxxx" });
    const data = await sendText(String(to), String(text));
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor WhatsApp rodando na porta ${PORT}`);
});
