// Cloudflare Pages Function — GET /api/download-planilha
//
// Server-side proxy that lets an authenticated dashboard user download the
// full spreadsheet stored in Backblaze B2, without ever exposing B2
// credentials to the browser.
//
// Authorization reuses the existing is_registered_employee() RLS policy:
// we forward the caller's Supabase access token to PostgREST and check that
// a `funcionarios` row comes back, instead of duplicating that logic here.

// SUPABASE_URL/ANON_KEY mirror the constants in app.js — the anon key is
// public by design (RLS is the real access boundary), so it's fine hardcoded
// here too. B2 credentials, by contrast, are real secrets and only ever come
// from env vars (see README/final output for the required Cloudflare Pages
// environment variables).
const SUPABASE_URL = "https://hpwuyriyoskvzmjnemaq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwd3V5cml5b3Nrdnptam5lbWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NTk1OTcsImV4cCI6MjEwMDEzNTU5N30.uiF0DkaNFM0ZMPG9POxW6yW3eBADhHCHTOTx6nB-wfo";

const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet({ request, env }) {
  const authHeader = request.headers.get("Authorization") || "";
  const accessToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonError("Não autenticado.", 401);

  // Reaproveita is_registered_employee() via RLS: uma linha de volta = acesso
  // liberado. RLS nega leitura anônima/não-cadastrada devolvendo lista vazia,
  // não erro — então lista vazia também é tratada como acesso negado.
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

  const { B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, EXCEL_CLOUD_NAME } = env;
  if (!B2_KEY_ID || !B2_APPLICATION_KEY || !B2_BUCKET_NAME || !EXCEL_CLOUD_NAME) {
    console.error("download-planilha: variáveis de ambiente do B2 ausentes.");
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
    console.error("download-planilha: falha na autenticação com o B2 —", err.message || err);
    return jsonError("Não foi possível autenticar com o armazenamento de arquivos.", 502);
  }

  // Downloads no B2 usam downloadUrl (não apiUrl) — apiUrl é só para as
  // demais chamadas da API nativa (b2_list_files_names etc).
  let fileRes;
  try {
    const downloadUrl = `${authData.apiInfo.storageApi.downloadUrl}/file/${encodeURIComponent(B2_BUCKET_NAME)}/${encodeURIComponent(EXCEL_CLOUD_NAME)}`;
    fileRes = await fetch(downloadUrl, {
      headers: { Authorization: authData.authorizationToken },
    });
    if (!fileRes.ok) throw new Error(`b2_download_file_by_name respondeu ${fileRes.status}`);
  } catch (err) {
    console.error("download-planilha: falha ao baixar do B2 —", err.message || err);
    return jsonError("Não foi possível baixar a planilha.", 502);
  }

  const filename = EXCEL_CLOUD_NAME.split("/").pop() || "QuimiaGestao.xlsx";
  return new Response(fileRes.body, {
    status: 200,
    headers: {
      "Content-Type": EXCEL_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
