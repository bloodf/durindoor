import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const literals = JSON.parse(readFileSync(resolve(__dirname, "../../public/i18n/literals/pt-BR.json"), "utf8"));
/** Shipped upstream #3473 translations retained for keys still present in source. */
const SHIPPED_TRANSLATIONS = {
  "API Key Name": "Nome da chave de API",
  "Activated": "Ativado",
  "Agent Skills": "Agent Skills",
  "Cached Cost": "Custo em cache",
  "Change the default dashboard password before activating the tunnel.": "Altere a senha padrão do painel antes de ativar o túnel.",
  "Combo": "Combo",
  "Compress prompts and outputs to save tokens": "Comprimir prompts e saídas para economizar tokens",
  "Connect to providers with OAuth to track your API quota limits and usage.": "Conectar-se aos provedores via OAuth para acompanhar seus limites de cota e uso da API.",
  "Context window": "Janela de contexto",
  "Deactivated": "Desativado",
  "Delete Proxy Pool": "Excluir Pool de Proxy",
  "Delete Proxy Pools": "Excluir Pools de Proxy",
  "Disable Dead Proxies": "Desativar Proxies Inativos",
  "Embedding": "Embedding",
  "Failed to delete proxy pool": "Falha ao excluir o pool de proxy",
  "Failed to fetch chart data:": "Falha ao buscar dados do gráfico:",
  "Failed to fetch quota": "Falha ao buscar a cota",
  "Failed to save proxy pool": "Falha ao salvar o pool de proxy",
  "Failed to test proxy": "Falha ao testar o proxy",
  "Failed to update active state": "Falha ao atualizar o estado ativo",
  "Fallback — try in order": "Fallback — tentar em ordem",
  "Fusion — panel + judge": "Fusion — painel + juiz",
  "Image to Text": "Imagem para Texto",
  "Input Cost": "Custo de entrada (input)",
  "JSON (Base64)": "JSON (Base64)",
  "Just now": "Agora mesmo",
  "Last Used": "Último uso",
  "MP3 (Binary)": "MP3 (Binário)",
  "Manage your proxy pool configurations": "Gerencie suas configurações de pools de proxy",
  "Music": "Música",
  "N/A": "N/D",
  "Never": "Nunca",
  "No API key usage recorded yet.": "Nenhum uso de chave de API registrado ainda.",
  "No account-specific usage recorded yet.": "Nenhum uso específico de conta registrado ainda.",
  "No endpoint usage recorded yet.": "Nenhum uso de endpoint registrado ainda.",
  "No usage recorded yet.": "Nenhum uso registrado ainda.",
  "Only letters, numbers, -, _ and . allowed": "Apenas letras, números, -, _ e . permitidos",
  "Open settings": "Abrir configurações",
  "Output Cost": "Custo de saída (output)",
  "Overview": "Visão geral",
  "Paste external_idp auth JSON from CLIProxyAPI/Kiro Microsoft login.": "Cole o JSON de autenticação external_idp do login CLIProxyAPI/Kiro Microsoft.",
  "Proxy pool created": "Pool de proxy criado",
  "Proxy pool deleted": "Pool de proxy excluído",
  "Proxy pool updated": "Pool de proxy atualizado",
  "Proxy test passed": "Teste de proxy aprovado",
  "Reading from AWS SSO cache": "Lendo do cache AWS SSO",
  "Reading from Cursor IDE database": "Lendo do banco de dados do IDE Cursor",
  "Recommended for most users. Free AWS account required.": "Recomendado para a maioria dos usuários. Conta AWS gratuita necessária.",
  "Round Robin — rotate": "Round Robin — rotacionar",
  "Skills": "Skills",
  "Speech To Text": "Fala para Texto",
  "Text To Speech": "Texto para Fala",
  "Text to Image": "Texto para Imagem",
  "The request is fulfilled by OpenAI, Anthropic, Gemini, or others instantly.": "A requisição é atendida por OpenAI, Anthropic, Gemini ou outros instantaneamente.",
  "This provider is ready to use. Optionally route requests through a proxy pool to bypass IP-based limits.": "Este provedor está pronto para uso. Opcionalmente, envie requisições por um pool de proxy para burlar limites por IP.",
  "This value is write-only after saving.": "Este valor é somente gravação após salvar.",
  "Today": "Hoje",
  "Token savings (estimated)": "Economia de tokens (estimada)",
  "Token will be auto-filled...": "O token será preenchido automaticamente...",
  "Tool not found or disabled.": "Ferramenta não encontrada ou desabilitada.",
  "Total Cost": "Custo total",
  "Track and manage your API quota limits": "Acompanhe e gerencie seus limites de cota da API",
  "Unknown": "Desconhecido",
  "Unknown Account": "Conta desconhecida",
  "Unknown Endpoint": "Endpoint desconhecido",
  "Unknown Key": "Chave desconhecida",
  "Unknown Model": "Modelo desconhecido",
  "Usage by API Key": "Uso por chave de API",
  "Usage by Account": "Uso por conta",
  "Usage by Endpoint": "Uso por endpoint",
  "Usage by Model": "Uso por modelo",
  "Use a long-lived Kiro/CodeWhisperer API key (headless auth).": "Use uma chave de API Kiro/CodeWhisperer duradoura (autenticação headless).",
  "Video": "Vídeo",
  "Vision": "Visão",
  "Web Fetch & Search": "Web Fetch e Busca",
  "Your requests start from your favorite tools or our unified SDK. Just change the base URL.": "Suas requisições começam das suas ferramentas favoritas ou do nosso SDK unificado. Apenas mude a URL base.",
  "web": "web"
};

describe("pt-BR shipped labels (upstream #3473)", () => {
  it("uses Portuguese instead of falling back to source English", () => {
    for (const [source, translated] of Object.entries(SHIPPED_TRANSLATIONS)) {
      expect(literals[source], source).toBe(translated);
    }
  });
});
