// Shared helpers for the Pages Functions under functions/api/.
//
// This file exports no onRequest* handler, so Pages Functions does not turn
// it into a route: Wrangler only creates routes from exports matching
// /^onRequest(Get|Post|...)?$/. It is bundled into each route that imports it.

// SUPABASE_URL/ANON_KEY mirror the constants in app.js — the anon key is
// public by design (RLS is the real access boundary), so it's fine hardcoded
// here too. B2 credentials, by contrast, are real secrets and only ever come
// from env vars (see README for the required Cloudflare Pages environment
// variables).
export const SUPABASE_URL = "https://hpwuyriyoskvzmjnemaq.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwd3V5cml5b3Nrdnptam5lbWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NTk1OTcsImV4cCI6MjEwMDEzNTU5N30.uiF0DkaNFM0ZMPG9POxW6yW3eBADhHCHTOTx6nB-wfo";

export function jsonError(message, status, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// Reaproveita is_registered_employee() via RLS: uma linha de volta = acesso
// liberado. RLS nega leitura anônima/não-cadastrada devolvendo lista vazia,
// não erro — então lista vazia também é tratada como acesso negado.
// Retorna null se a sessão for válida, ou a Response de erro.
export async function checkSupabaseSession(accessToken) {
  let checkRes;
  try {
    checkRes = await fetch(`${SUPABASE_URL}/rest/v1/funcionarios?select=id&limit=1`, {
      headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
    });
  } catch {
    return jsonError("Não foi possível verificar suas permissões.", 403);
  }
  if (!checkRes.ok) return jsonError("Não foi possível verificar suas permissões.", 403);

  const rows = await checkRes.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) return jsonError("Acesso negado.", 403);
  return null;
}

// Valida a chave pessoal do Excel pela RPC anônima validate_excel_token.
// Só um `true` literal libera. Retorna "ok", "invalid" ou "error".
// A chave nunca é logada: os logs abaixo são textos fixos.
export async function validateExcelToken(key) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_excel_token`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: key }),
    });
  } catch {
    console.error("validate_excel_token: falha de rede ao validar a chave.");
    return "error";
  }
  if (!res.ok) {
    console.error(`validate_excel_token: RPC respondeu ${res.status}.`);
    return "error";
  }
  const body = await res.json().catch(() => null);
  return body === true ? "ok" : "invalid";
}

// Busca no Backblaze B2 o objeto nomeado por env[objectEnvVar] e o devolve
// como anexo. As credenciais do B2 só existem aqui, no servidor.
export async function serveB2File(env, { objectEnvVar, label, contentType, fallbackName, failMessage }) {
  const { B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME } = env;
  const objectName = env[objectEnvVar];
  if (!B2_KEY_ID || !B2_APPLICATION_KEY || !B2_BUCKET_NAME || !objectName) {
    console.error(`${label}: variáveis de ambiente do B2 ausentes.`);
    return jsonError("Configuração do servidor incompleta.", 500);
  }

  let authData;
  try {
    const authRes = await fetch("https://api.backblazeb2.com/b2api/v4/b2_authorize_account", {
      headers: { Authorization: "Basic " + btoa(`${B2_KEY_ID}:${B2_APPLICATION_KEY}`) },
    });
    if (!authRes.ok) throw new Error(`b2_authorize_account respondeu ${authRes.status}`);
    authData = await authRes.json();
  } catch (err) {
    console.error(`${label}: falha na autenticação com o B2 —`, err.message || err);
    return jsonError("Não foi possível autenticar com o armazenamento de arquivos.", 502);
  }

  // Downloads no B2 usam downloadUrl (não apiUrl) — apiUrl é só para as
  // demais chamadas da API nativa (b2_list_files_names etc).
  let fileRes;
  try {
    const downloadUrl = `${authData.apiInfo.storageApi.downloadUrl}/file/${encodeURIComponent(B2_BUCKET_NAME)}/${encodeURIComponent(objectName)}`;
    fileRes = await fetch(downloadUrl, {
      headers: { Authorization: authData.authorizationToken },
    });
    if (!fileRes.ok) throw new Error(`b2_download_file_by_name respondeu ${fileRes.status}`);
  } catch (err) {
    console.error(`${label}: falha ao baixar do B2 —`, err.message || err);
    return jsonError(failMessage, 502);
  }

  const filename = objectName.split("/").pop() || fallbackName;
  return new Response(fileRes.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
