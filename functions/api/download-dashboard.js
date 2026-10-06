// Cloudflare Pages Function — GET /api/download-dashboard
//
// Downloads the Excel dashboard (.xlsm) stored in Backblaze B2, named by the
// DASHBOARD_CLOUD_NAME env var. Only the web app's Supabase session (Bearer)
// is accepted here: the personal Excel key is for the data file only, so a
// Basic header is rejected like any other non-Bearer request, and no
// WWW-Authenticate header is ever sent.

import { jsonError, checkSupabaseSession, serveB2File } from "../_lib/server-helpers.js";

const XLSM_MIME = "application/vnd.ms-excel.sheet.macroEnabled.12";

export async function onRequestGet({ request, env }) {
  const authHeader = request.headers.get("Authorization") || "";
  const accessToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonError("Não autenticado.", 401);

  const denied = await checkSupabaseSession(accessToken);
  if (denied) return denied;

  return serveB2File(env, {
    objectEnvVar: "DASHBOARD_CLOUD_NAME",
    label: "download-dashboard",
    contentType: XLSM_MIME,
    fallbackName: "QuimiaGestao_Dashboard.xlsm",
    failMessage: "Não foi possível baixar o dashboard.",
  });
}
