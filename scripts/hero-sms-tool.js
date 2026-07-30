#!/usr/bin/env node

/**
 * Ferramenta CLI para interagir com a API da Hero SMS (compatível com o protocolo SMS-Activate).
 * Uso:
 *   node scripts/hero-sms-tool.js balance <api_key>
 *   node scripts/hero-sms-tool.js get <api_key> [service] [country]
 *   node scripts/hero-sms-tool.js status <api_key> <activation_id>
 *   node scripts/hero-sms-tool.js set <api_key> <activation_id> <status>
 */

const base = "https://hero-sms.com/stubs/handler_api.php";

async function request(params) {
  const query = new URLSearchParams(params).toString();
  const url = `${base}?${query}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    return text.trim();
  } catch (err) {
    console.error("Erro na requisição:", err.message);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  if (!action || !["balance", "get", "status", "set"].includes(action)) {
    console.log("Uso:");
    console.log("  node scripts/hero-sms-tool.js balance <api_key>");
    console.log("  node scripts/hero-sms-tool.js get <api_key> [service=wa] [country=73 (Brasil)]");
    console.log("  node scripts/hero-sms-tool.js status <api_key> <activation_id>");
    console.log("  node scripts/hero-sms-tool.js set <api_key> <activation_id> <status_code>");
    console.log("\nStatus codes úteis:");
    console.log("  1: Informar que o SMS foi enviado (pronto)");
    console.log("  3: Pedir novo SMS (re-tentar)");
    console.log("  6: Completar ativação (sucesso)");
    console.log("  8: Cancelar ativação (reembolsar saldo)");
    process.exit(0);
  }

  const apiKey = args[1];
  if (!apiKey) {
    console.error("Erro: api_key é obrigatória.");
    process.exit(1);
  }

  if (action === "balance") {
    const res = await request({ action: "getBalance", api_key: apiKey });
    if (res.startsWith("ACCESS_BALANCE")) {
      console.log(`Saldo: ${res.split(":")[1]}`);
    } else {
      console.log(`Resposta da API: ${res}`);
    }
  } 
  
  else if (action === "get") {
    const service = args[2] || "wa"; // wa = WhatsApp
    const country = args[3] || "73";  // 73 = Brasil (exemplo)
    
    console.log(`Solicitando número para o serviço "${service}" (país: ${country})...`);
    const res = await request({
      action: "getNumber",
      api_key: apiKey,
      service,
      country
    });

    if (res.startsWith("ACCESS_NUMBER")) {
      const parts = res.split(":");
      const id = parts[1];
      const number = parts[2];
      console.log("\n=================================");
      console.log("Sucesso ao comprar número!");
      console.log(`ID de Ativação: ${id}`);
      console.log(`Número de Telefone: +${number}`);
      console.log("=================================");
      console.log(`\nPara checar se o SMS chegou, execute:`);
      console.log(`node scripts/hero-sms-tool.js status ${apiKey} ${id}`);
    } else {
      console.error(`Erro da API: ${res}`);
    }
  } 
  
  else if (action === "status") {
    const id = args[2];
    if (!id) {
      console.error("Erro: activation_id é obrigatório.");
      process.exit(1);
    }

    console.log(`Verificando status do SMS para ativação ${id}...`);
    const res = await request({
      action: "getStatus",
      api_key: apiKey,
      id
    });

    console.log(`Resposta da API: ${res}`);
    if (res.startsWith("STATUS_OK")) {
      console.log(`Código SMS recebido: ${res.split(":")[1]}`);
    } else if (res === "STATUS_WAIT_CODE") {
      console.log("Aguardando o recebimento do SMS...");
    } else if (res === "STATUS_CANCEL") {
      console.log("A ativação foi cancelada.");
    }
  } 
  
  else if (action === "set") {
    const id = args[2];
    const status = args[3];
    if (!id || !status) {
      console.error("Erro: activation_id e status_code são obrigatórios.");
      process.exit(1);
    }

    console.log(`Definindo status da ativação ${id} para ${status}...`);
    const res = await request({
      action: "setStatus",
      api_key: apiKey,
      id,
      status
    });

    console.log(`Resposta da API: ${res}`);
  }
}

main().catch((err) => {
  console.error("Erro inesperado:", err);
});
