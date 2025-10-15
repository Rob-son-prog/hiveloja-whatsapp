// phone.js
// Normaliza número BR em E.164, assumindo DDI 55 e DDD 65 por padrão
export function toE164BR(raw, defaultDDD = "65") {
  const onlyDigits = String(raw || "").replace(/\D/g, "");

  // Já começa com 55? então assume que já veio com DDI
  if (onlyDigits.startsWith("55")) {
    // Ex.: 55 + DDD(2) + 8 dígitos -> precisa inserir o 9 depois do DDD
    if (onlyDigits.length === 12) {
      return "+55" + onlyDigits.slice(2, 4) + "9" + onlyDigits.slice(4);
      //      ^^ CORRIGIDO: adiciona o +
    }
    return "+" + onlyDigits;
  }

  // Se veio só local/DDD
  if (onlyDigits.length === 9) {
    // 9 + 8 dígitos (sem DDD)
    return `+55${defaultDDD}${onlyDigits}`;
  }
  if (onlyDigits.length === 10) {
    // DDD(2) + 8 dígitos -> insere 9 depois do DDD
    return `+55${onlyDigits.slice(0, 2)}9${onlyDigits.slice(2)}`;
  }
  if (onlyDigits.length === 11) {
    // DDD(2) + 9 dígitos (correto)
    return `+55${onlyDigits}`;
  }

  // fallback: retorna com + e deixa a API validar
  return `+${onlyDigits}`;
}
