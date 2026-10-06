// Cloudflare Pages Function — GET /api/download-planilha
//
// Server-side proxy that lets an authenticated dashboard user download the
// full spreadsheet stored in Backblaze B2, without ever exposing B2
// credentials to the browser.
//
// Two Authorization schemes are accepted:
// - "Bearer <token>": the web app's Supabase session. Authorization reuses
//   the existing is_registered_employee() RLS policy (see checkSupabaseSession).
// - "Basic <base64>": the personal Excel key, for Power Query. The username
//   is ignored; the password is validated by validate_excel_token().
//
// Only a request with no Authorization header gets WWW-Authenticate, so Excel
// prompts for credentials. Every other failure omits it, so browsers never
// show their native Basic-auth dialog to site users.

import {
  jsonError,
  checkSupabaseSession,
  validateExcelToken,
  serveB2File,
} from "../_lib/server-helpers.js";

const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Decodifica "Basic <base64>" e devolve tudo após o PRIMEIRO ":" (a senha),
// ou null se o cabeçalho estiver malformado. O valor nunca é logado.
function passwordFromBasic(encoded) {
  try {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    return decoded.slice(sep + 1) || null;
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader === null) {
    return jsonError("Não autenticado.", 401, {
      "WWW-Authenticate": 'Basic realm="Quimia", charset="UTF-8"',
    });
  }

  const accessToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  const basicCredentials = authHeader.match(/^Basic\s+(\S+)$/i)?.[1];

  if (accessToken) {
    const denied = await checkSupabaseSession(accessToken);
    if (denied) return denied;
  } else if (basicCredentials) {
    const key = passwordFromBasic(basicCredentials);
    if (!key) return jsonError("Credenciais inválidas.", 401);
    const result = await validateExcelToken(key);
    if (result === "error") return jsonError("Não foi possível verificar suas permissões.", 403);
    if (result !== "ok") return jsonError("Chave do Excel inválida ou revogada.", 401);
  } else {
    return jsonError("Não autenticado.", 401);
  }

  return serveB2File(env, {
    objectEnvVar: "EXCEL_CLOUD_NAME",
    label: "download-planilha",
    contentType: EXCEL_MIME,
    fallbackName: "QuimiaGestao.xlsx",
    failMessage: "Não foi possível baixar a planilha.",
  });
}
