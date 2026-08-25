/* ─────────────────────────────────────────────────────────────────
   Cliente Supabase e estado de dados. Os dados reais são buscados
   depois do login, em loadDashboardData().

   SEGURANÇA — a SUPABASE_ANON_KEY abaixo é PÚBLICA por design. É a chave
   "anon" do Supabase, feita para rodar no navegador e ficar visível no
   código-fonte. Ela NÃO é um segredo: a fronteira de acesso real é o Row
   Level Security (RLS) no Postgres, que só libera as linhas do próprio
   usuário autenticado. Nunca coloque aqui a chave service_role (essa sim
   é secreta e ignora o RLS). Ver README.md para detalhes.
   ───────────────────────────────────────────────────────────────── */
const SUPABASE_URL = "https://hpwuyriyoskvzmjnemaq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwd3V5cml5b3Nrdnptam5lbWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NTk1OTcsImV4cCI6MjEwMDEzNTU5N30.uiF0DkaNFM0ZMPG9POxW6yW3eBADhHCHTOTx6nB-wfo";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let people = [];
let project = { byArea: {}, byStatus: {}, hoursByArea: {} };

// Mapa de cores de status. Direção semântica do dono do projeto: cinza para
// os estados iniciais/não começados, âmbar para os "em andamento", verde/teal
// para concluído, e vermelho SÓ para bloqueado/travado (não há status desse
// tipo entre os valores conhecidos, então nenhum recebe vermelho aqui).
// Cobre o vocabulário em inglês já existente + os valores em português citados
// (A fazer, Fazendo, Concluído). Qualquer status fora do mapa cai no fallback
// neutro (fallbackColor/fallbackTextColor), então um status novo não quebra —
// fica cinza até o mapa ser atualizado.
const statusColor = {
  // não começado → cinza
  "Backlog": "#8B9C96", "To Do": "#8B9C96", "A fazer": "#8B9C96",
  // em andamento → âmbar
  "In Progress": "#D6A73B", "Fazendo": "#D6A73B",
  // etapas intermediárias distintas (revisão / teste) → cores próprias da paleta
  "Code Review": "#0E718F", "Testing": "#61B8D8",
  // concluído → verde
  "Done": "#2CD195", "Concluído": "#2CD195",
};
const statusTextColor = {
  "Backlog": "#62766F", "To Do": "#62766F", "A fazer": "#62766F",
  "In Progress": "#8A6A12", "Fazendo": "#8A6A12",
  "Code Review": "#0E718F", "Testing": "#245F73",
  "Done": "#158A64", "Concluído": "#158A64",
};
const fallbackColor = "#8B9C96";
const fallbackTextColor = "#62766F";
const lateColor = "#C24545";
// Âmbar para a escala de urgência dos prazos (0–3 e 4–7 dias). Mesmos tons
// âmbar já presentes no tema (nada de hex novo) — a intensidade do fundo
// diferencia o balde 0–3 (mais forte) do 4–7 (mais leve).
const soonColor = "#D6A73B";
const soonTextColor = "#8A6A12";
// Prioridade em vermelho/âmbar/cinza para comunicar urgência, reutilizando as
// MESMAS constantes já existentes (um só vermelho, um só âmbar, um só cinza no
// app): Highest/High → lateColor, Medium → soonColor, Low/Lowest → fallback.
const priorityColor = { "Highest": lateColor, "High": lateColor, "Medium": soonColor, "Low": fallbackColor, "Lowest": fallbackColor };
const priorityTextColor = { "Highest": lateColor, "High": lateColor, "Medium": soonTextColor, "Low": fallbackTextColor, "Lowest": fallbackTextColor };
// Escala teal original da prioridade, mantida apenas para o donut e a legenda
// adjacente em renderPersonOverview (os badges da tabela usam priorityColor).
const priorityChartColor = { "Highest": "#0E718F", "High": "#1B7A7A", "Medium": "#36C6C6", "Low": "#61B8D8", "Lowest": "#58E4A9" };
const priorityChartTextColor = { "Highest": "#0E718F", "High": "#1B7A7A", "Medium": "#186666", "Low": "#22787F", "Lowest": "#22787F" };
const areaColor = "#1F6E74";
const hoursAreaColor = "#3AA0C7";

let chart1, chart2;
let entity = { type: "person", index: 0 };
let view = "overview";

const listEl = document.getElementById("people-list");
const projectBtn = document.getElementById("project-btn");
const contentEl = document.getElementById("content");
const tabsEl = document.getElementById("view-tabs");

/* ─────────────────────────────────────────────────────────────────
   Utilidades de animação — respeitam prefers-reduced-motion. Toda
   animação nova em JS passa por aqui, e a query de reduced-motion no
   CSS zera as animações puramente declarativas (fade-in, stagger…).
   ───────────────────────────────────────────────────────────────── */
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Conta de 0 até `to` em ~600ms (easeOutCubic). Sem animação, escreve direto.
// `format` opcional formata cada quadro (ex.: horas → "60h24").
function animateCount(el, to, duration = 600, format = null) {
  const target = Number(to);
  const isInt = Number.isInteger(target);
  const fmt = format || (v => isInt ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  if (!isFinite(target) || prefersReducedMotion() || duration <= 0) {
    el.textContent = fmt(target);
    return;
  }
  const start = performance.now();
  function frame(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(target * eased);
    if (p < 1) requestAnimationFrame(frame);
    else el.textContent = fmt(target);
  }
  requestAnimationFrame(frame);
}

// Anima todo elemento com [data-count-to] dentro de `root`. Com
// data-count-format="hoursmin", formata o valor como horas e minutos.
function runCounters(root) {
  root.querySelectorAll("[data-count-to]").forEach(el => {
    const format = el.dataset.countFormat === "hoursmin" ? (v => formatHoursMinutes(v)) : null;
    animateCount(el, el.dataset.countTo, 600, format);
  });
}

// Converte horas decimais em "60h 24min" (60,4h = 60h e 24min, não 60h40min).
// Minutos com dois dígitos e unidade explícita; arredonda 59,99min → sobe a hora.
function formatHoursMinutes(decimalHours) {
  const total = Number(decimalHours) || 0;
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  let h = Math.floor(abs);
  let m = Math.round((abs - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return `${sign}${h}h ${String(m).padStart(2, "0")}min`;
}

// Faz os cards aparecerem em cascata (cada um com um pequeno atraso).
function staggerCards(root) {
  const reduce = prefersReducedMotion();
  root.querySelectorAll(".card").forEach((card, i) => {
    card.style.animationDelay = reduce ? "0ms" : Math.min(i, 8) * 55 + "ms";
  });
}

// Transição breve no #content ao trocar de pessoa/aba, no lugar do swap seco.
function playContentSwap() {
  if (prefersReducedMotion()) return;
  contentEl.style.animation = "none";
  void contentEl.offsetWidth;
  contentEl.style.animation = "contentSwap 190ms ease both";
}

// Escapa texto vindo do banco antes de injetar via innerHTML — defesa em
// profundidade contra XSS. O write path hoje é o pipeline Python (confiável,
// ClickUp/Clockify), mas nunca confiamos em dado de query ao montar HTML.
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Fonte única do avatar de uma pessoa: foto quando houver (photoUrl), senão
// o círculo de iniciais colorido — mesmas dimensões circulares em ambos os
// casos. Usada tanto na sidebar (32px) quanto no cabeçalho da pessoa (68px)
// para o markup não divergir entre os pontos de uso.
const AVATAR_FONT_BY_SIZE = { 32: 13, 68: 21 };

function initialsCircleHTML(person, sizePx, extraClass = "") {
  const fontPx = AVATAR_FONT_BY_SIZE[sizePx] || Math.round(sizePx * 0.4);
  return `<span class="avatar-ring${extraClass ? " " + extraClass : ""}" style="width: ${sizePx}px; height: ${sizePx}px; font-size: ${fontPx}px; background: ${person.ringColor};">${escapeHtml(person.initials)}</span>`;
}

// extraClass: hook para overrides responsivos via CSS (ex: !important em
// media query) já que width/height/font-size aqui são inline, definidos
// dinamicamente por sizePx.
function avatarHTML(person, sizePx, extraClass = "") {
  if (!person.photoUrl) return initialsCircleHTML(person, sizePx, extraClass);
  // Foto presente: <img> circular. Se a URL falhar (link quebrado, arquivo
  // apagado, rede), onerror troca a imagem pelo círculo de iniciais — nunca
  // deixamos aparecer o ícone de imagem quebrada.
  return `<img src="${escapeHtml(person.photoUrl)}" alt="${escapeHtml(person.name)}"${extraClass ? ` class="${extraClass}"` : ""}
    style="width: ${sizePx}px; height: ${sizePx}px; border-radius: 50%; object-fit: cover; flex-shrink: 0; display: block; background: ${person.ringColor};"
    data-initials="${escapeHtml(person.initials)}" data-ring="${escapeHtml(person.ringColor)}" data-size="${sizePx}"
    onerror="avatarImgFallback(this)">`;
}

// Substitui um <img> de avatar que falhou pelo círculo de iniciais equivalente.
// Global de propósito: é chamada pelo onerror inline dos <img> gerados acima.
function avatarImgFallback(img) {
  const size = Number(img.dataset.size) || 32;
  const fontPx = AVATAR_FONT_BY_SIZE[size] || Math.round(size * 0.4);
  const span = document.createElement("span");
  const extraClass = Array.from(img.classList).filter(c => c !== "avatar-ring").join(" ");
  span.className = extraClass ? `avatar-ring ${extraClass}` : "avatar-ring";
  span.style.width = size + "px";
  span.style.height = size + "px";
  span.style.fontSize = fontPx + "px";
  span.style.background = img.dataset.ring || "#1F6E74";
  span.textContent = img.dataset.initials || ""; // textContent: seguro contra XSS
  img.replaceWith(span);
}

function tilesHTML(data, bgMap, textMap) {
  return Object.entries(data).map(([label, count]) => {
    const bg = bgMap[label] || fallbackColor;
    const text = textMap[label] || fallbackTextColor;
    return `
    <div style="width: 76px; height: 76px; border-radius: 10px; background: ${bg}1F; border: 1px solid ${bg}55; padding: 7px 9px; display: flex; flex-direction: column; justify-content: space-between;">
      <span class="num" style="font-size: 14px; color: ${text}; align-self: flex-end; font-weight: 600;">${count}</span>
      <span style="font-size: 10.5px; line-height: 1.25; color: ${text}; font-weight: 500;">${escapeHtml(label)}</span>
    </div>`;
  }).join("");
}

function emptyState(message) {
  return `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px 20px; color: var(--muted-soft); text-align: center;">
      <svg width="30" height="30" viewBox="0 0 26 26" aria-hidden="true" style="margin-bottom: 10px; opacity: 0.6;">
        <path d="M11.85,1.21C11.47,0.83 10.46,0.83 9.56,1.00C8.65,1.17 7.50,1.56 6.43,2.25C5.35,2.95 3.99,3.89 3.09,5.17C2.18,6.46 1.28,8.41 1.00,9.97C0.72,11.54 0.86,13.35 1.42,14.57C1.97,15.78 2.98,16.86 4.34,17.28C5.70,17.70 9.42,17.45 9.56,17.07C9.70,16.69 6.04,15.99 5.17,14.98C4.30,13.97 4.20,12.20 4.34,11.02C4.48,9.83 4.76,9.17 6.01,7.89C7.26,6.60 10.88,4.41 11.85,3.30C12.83,2.18 12.23,1.59 11.85,1.21Z" fill="currentColor"/>
        <path d="M19.78,13.31C18.88,11.82 16.48,10.32 14.98,9.77C13.49,9.21 11.57,9.56 10.81,9.97C10.04,10.39 9.73,11.19 10.39,12.27C11.05,13.35 14.15,15.30 14.77,16.44C15.40,17.59 14.57,18.39 14.15,19.16C13.73,19.92 13.70,20.27 12.27,21.03C10.84,21.80 5.73,23.09 5.59,23.75C5.45,24.41 9.52,25.07 11.43,25.00C13.35,24.93 15.57,24.37 17.07,23.33C18.57,22.29 19.96,20.41 20.41,18.74C20.86,17.07 20.69,14.81 19.78,13.31Z" fill="currentColor"/>
      </svg>
      <p style="font-size: 12px; margin: 0;">${message}</p>
    </div>`;
}

// Estado de erro — mesma família visual do emptyState, mas em tom de alerta
// (--late) e capaz de listar a mensagem/detalhe/dica reais do Postgrest.
function errorState(title, lines) {
  const items = lines.map(l =>
    `<p style="font-size: 11.5px; margin: 0; color: var(--late); line-height: 1.5; word-break: break-word;">${escapeHtml(l)}</p>`
  ).join("");
  return `
    <div class="card" style="border-color: var(--late); background: var(--late-wash); padding: 18px 20px; display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--late)" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.4v.2"/>
        </svg>
        <p style="font-size: 13px; font-weight: 600; margin: 0; color: var(--late);">${title}</p>
      </div>
      ${items}
    </div>`;
}

// Fallback de texto para um gráfico sem dados (mesma linguagem visual/apagada
// do emptyState, porém compacto para caber no espaço do canvas).
function chartEmpty(message) {
  return `<div style="height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; color: var(--muted-soft); font-size: 11px; padding: 6px;">${message}</div>`;
}

// Cria o gráfico só se houver dados; senão troca o canvas por um fallback.
function mountChart(canvasId, hasData, configFactory) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (!hasData) {
    canvas.parentElement.innerHTML = chartEmpty("Sem dados para exibir.");
    return null;
  }
  return new Chart(canvas, configFactory());
}

// Rótulo de eixo abreviado: primeiro nome + inicial do segundo token + ".".
// ex: "Miguel Felix Cardozo de Tomy" -> "Miguel F.", "Nicolas Delecrode" ->
// "Nicolas D.". Nome de uma palavra só é devolvido como está (sem ponto),
// já que não há um segundo token para abreviar. Curto o bastante para o
// auto-skip/auto-rotation padrão do Chart.js lidar bem sem ajuda extra.
function abbreviateNameLabel(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
}

// Rótulo da coluna "Restante" — fonte única da verdade compartilhada entre
// a tabela (taskRow), o KPI de atrasadas e o CSV, para que nunca divirjam.
function remainingLabel(t) {
  if (t.done) return "concluída";
  if (t.late) return "atrasada";
  if (t.noDueDate) return "sem prazo";
  return t.days + "d";
}

// Escala graduada de urgência do prazo, compartilhada pela coluna "Restante"
// e pelos mini-cards de "Próximos prazos"/"Tarefas mais urgentes":
//   atrasada (days < 0) → vermelho | 0–3 dias → âmbar forte
//   4–7 dias → âmbar leve | 8+ dias (ou concluída/sem prazo) → neutro
function urgencyStyle(t) {
  if (t.done) return { bg: "var(--border-soft)", color: "var(--muted)" };
  if (t.late) return { bg: lateColor + "22", color: lateColor };
  if (t.noDueDate) return { bg: "var(--border-soft)", color: "var(--muted)" };
  if (t.days <= 3) return { bg: soonColor + "33", color: soonTextColor };
  if (t.days <= 7) return { bg: soonColor + "1A", color: soonTextColor };
  return { bg: "var(--border-soft)", color: "var(--muted)" };
}

function taskRow(t, showAssignee) {
  const statusBg = statusColor[t.status] || fallbackColor;
  const statusText = statusTextColor[t.status] || fallbackTextColor;
  const priBg = priorityColor[t.priority] || fallbackColor;
  const priText = priorityTextColor[t.priority] || fallbackTextColor;
  const u = urgencyStyle(t);
  return `
    <tr>
      <td class="num" style="color: var(--muted); font-size: 11.5px;">${escapeHtml(t.id)}</td>
      <td style="font-weight: 500;">${escapeHtml(t.title)}</td>
      ${showAssignee ? `<td style="color: var(--muted);">${escapeHtml(t.assignee)}</td>` : ""}
      <td><span class="badge" style="background: ${statusBg}22; color: ${statusText};">${escapeHtml(t.status)}</span></td>
      <td><span class="badge" style="background: ${priBg}1A; color: ${priText};">${escapeHtml(t.priority)}</span></td>
      <td class="num" style="color: var(--muted);">${t.due}</td>
      <td><span class="badge num" style="background: ${u.bg}; color: ${u.color};">${remainingLabel(t)}</span></td>
      <td style="color: var(--muted-soft); font-size: 11px;">${t.tags.map(escapeHtml).join(", ") || "—"}</td>
    </tr>`;
}

/* ─────────────────────────────────────────────────────────────────
   Exportação da tabela visível (renderDetails) para CSV — 100% no
   cliente, via Blob + <a> temporário. Escapa aspas/vírgulas/quebras.
   ───────────────────────────────────────────────────────────────── */
const BOM = "﻿"; // marca UTF-8 para o Excel abrir acentos corretamente
const CSV_SEP = ";"; // ponto-e-vírgula: Excel pt-BR usa vírgula como decimal

// Escapa um campo para CSV com separador ";" — cita se contiver aspas, o
// próprio separador ou quebras de linha, e dobra aspas internas.
function csvCell(value) {
  const s = value == null ? "" : String(value);
  return /["\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Fonte única dos dados exportados (CSV e XLSX partem daqui), no mesmo escopo
// e com as mesmas colunas da tabela visível em renderDetails(). Dados crus —
// o escape de HTML NÃO se aplica a arquivos, só à injeção via innerHTML.
function currentExportData() {
  const isProject = entity.type === "project";
  const tasks = isProject
    ? people.flatMap(p => p.tasks.map(t => ({ ...t, assignee: p.name })))
    : (people[entity.index] ? people[entity.index].tasks : []);

  const headers = ["ID", "Tarefa", ...(isProject ? ["Responsável"] : []), "Status", "Prioridade", "Prazo", "Restante", "Etiquetas"];
  const rows = tasks.map(t => [
    t.id, t.title, ...(isProject ? [t.assignee] : []), t.status, t.priority, t.due, remainingLabel(t), t.tags.join(", "),
  ]);
  const scope = isProject ? "projeto" : (people[entity.index]?.name || "colaborador").replace(/\s+/g, "-").toLowerCase();
  return { headers, rows, scope, empty: tasks.length === 0 };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportDetailsCSV() {
  const { headers, rows, scope, empty } = currentExportData();
  if (empty) return;
  const csv = [headers, ...rows]
    .map(row => row.map(csvCell).join(CSV_SEP))
    .join("\r\n");
  // BOM garante que o Excel abra em UTF-8 (acentos nas tarefas/nomes).
  downloadBlob(new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" }), `tarefas-${scope}.csv`);
}

function exportDetailsXLSX() {
  const { headers, rows, scope, empty } = currentExportData();
  if (empty) return;
  if (typeof XLSX === "undefined") {
    console.error("SheetJS (XLSX) não carregou — não foi possível exportar em .xlsx.");
    return;
  }
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Tarefas");
  XLSX.writeFile(workbook, `tarefas-${scope}.xlsx`);
}

function renderDetails() {
  const isProject = entity.type === "project";
  const tasks = isProject
    ? people.flatMap(p => p.tasks.map(t => ({ ...t, assignee: p.name })))
    : people[entity.index].tasks;
  const rows = tasks.map(t => taskRow(t, isProject)).join("");

  contentEl.innerHTML = `
    <div class="card fade-in" style="padding: 6px 8px;">
      ${rows ? `
      <div class="export-row">
        <button onclick="exportDetailsCSV()" class="btn-outline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12M7 11l5 5 5-5M5 21h14"/></svg>
          Exportar CSV
        </button>
        <button onclick="exportDetailsXLSX()" class="btn-outline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v6h6M9 13l3 4m0-4l-3 4"/></svg>
          Exportar Excel
        </button>
      </div>
      <div style="overflow-x: auto;">
        <table>
          <thead><tr>
            <th>ID</th><th>Tarefa</th>${isProject ? "<th>Responsável</th>" : ""}<th>Status</th><th>Prioridade</th><th>Prazo</th><th>Restante</th><th>Etiquetas</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : emptyState("Nenhuma tarefa por aqui ainda.")}
    </div>`;
}

function renderPersonOverview(person) {
  contentEl.innerHTML = `
    <div class="card fade-in person-header-card">
      ${avatarHTML(person, 68, "person-avatar")}
      <div class="person-header-info">
        <p class="display person-name">${escapeHtml(person.name)}</p>
        <p class="person-area">${escapeHtml(person.area)}</p>
      </div>
      <div class="kpi-row">
        <div>
          <p class="eyebrow kpi-label" style="margin: 0 0 3px;">Concluídas</p>
          <p class="num kpi-value" style="color: var(--done-ink);"><span data-count-to="${person.kpis.done}">0</span><span style="color: var(--muted-soft); font-size: 12px;">/${person.kpis.total}</span></p>
        </div>
        <div>
          <p class="eyebrow kpi-label" style="margin: 0 0 3px;">Atrasadas</p>
          <p class="num kpi-value" style="color: ${person.kpis.late > 0 ? "var(--late)" : "var(--ink)"};"><span data-count-to="${person.kpis.late}">0</span></p>
        </div>
        <div>
          <p class="eyebrow kpi-label" style="margin: 0 0 3px;">Horas</p>
          <p class="num kpi-value"><span data-count-to="${person.kpis.hours}" data-count-format="hoursmin">${formatHoursMinutes(0)}</span></p>
        </div>
      </div>
    </div>

    <div class="card fade-in" style="padding: 15px 17px; margin-bottom: 14px;">
      <p style="font-size: 12.5px; font-weight: 600; margin: 0 0 10px;">Status das tarefas</p>
      <div style="display: flex; gap: 9px; flex-wrap: wrap;">${Object.keys(person.status).length ? tilesHTML(person.status, statusColor, statusTextColor) : chartEmpty("Nenhuma tarefa registrada.")}</div>
    </div>

    <div class="charts-grid-2">
      <div class="card fade-in" style="padding: 15px 17px;">
        <p style="font-size: 12.5px; font-weight: 600; margin: 0 0 10px;">Tarefas por prioridade</p>
        <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
          <div class="chart-donut-box"><canvas id="c1" role="img" aria-label="Tarefas por prioridade"></canvas></div>
          <div style="display: flex; flex-direction: column; gap: 7px;">
            ${Object.entries(person.priority).map(([label, count]) => `
              <div style="display: flex; align-items: center; gap: 7px; font-size: 11.5px;">
                <span style="width: 8px; height: 8px; border-radius: 50%; background: ${priorityChartColor[label] || fallbackColor}; flex-shrink: 0;"></span>
                <span style="color: var(--muted);">${escapeHtml(label)}</span>
                <span class="num" style="font-weight: 600; margin-left: auto;">${count}</span>
              </div>`).join("")}
          </div>
        </div>
      </div>
      <div class="card fade-in" style="padding: 15px 17px;">
        <p style="font-size: 12.5px; font-weight: 600; margin: 0 0 10px;">Horas apontadas (trimestre)</p>
        <div class="chart-box-sm"><canvas id="c2" role="img" aria-label="Horas apontadas por mês"></canvas></div>
      </div>
    </div>

    <div class="card fade-in" style="padding: 15px 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <p style="font-size: 12.5px; font-weight: 600; margin: 0;">Próximos prazos</p>
        <button onclick="view='details'; renderAll();" style="border: none; background: transparent; color: var(--teal); font-size: 11.5px; cursor: pointer; padding: 0; font-weight: 500;">Ver detalhamento completo →</button>
      </div>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        ${person.tasks.length ? [...person.tasks].sort((a, b) => a.days - b.days).slice(0, 3).map(t => {
          const u = urgencyStyle(t);
          return `
          <div style="flex: 1; min-width: 150px; border: 1px solid var(--border); border-radius: 11px; padding: 11px 13px; transition: border-color 120ms ease;">
            <p style="font-size: 12px; margin: 0 0 7px; line-height: 1.35; font-weight: 500;">${escapeHtml(t.title)}</p>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="num" style="font-size: 11px; color: var(--muted);">${t.due}</span>
              <span class="badge" style="background: ${u.bg}; color: ${u.color};">${remainingLabel(t)}</span>
            </div>
          </div>`;
        }).join("") : emptyState("Sem prazos próximos.")}
      </div>
    </div>`;

  if (chart1) chart1.destroy();
  chart1 = mountChart("c1", Object.keys(person.priority).length > 0, () => ({
    type: "doughnut",
    data: { labels: Object.keys(person.priority), datasets: [{ data: Object.values(person.priority), backgroundColor: Object.keys(person.priority).map(l => priorityChartColor[l] || fallbackColor), borderColor: "#ffffff", borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false } } }
  }));

  if (chart2) chart2.destroy();
  chart2 = mountChart("c2", person.months.length > 0, () => ({
    type: "line",
    data: { labels: person.months, datasets: [{ data: person.hoursSeries, borderColor: "#1F6E74", backgroundColor: "rgba(31,110,116,0.08)", fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: "#1F6E74" }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => formatHoursMinutes(ctx.parsed.y) } } },
      scales: { y: { beginAtZero: true, grid: { color: "#EBF5F3" } }, x: { grid: { display: false } } } }
  }));
}

function renderProjectOverview() {
  contentEl.innerHTML = `
    <div class="card fade-in" style="padding: 17px 20px; margin-bottom: 14px; display: flex; align-items: center; gap: 18px;">
      <div style="width: 58px; height: 58px; border-radius: 13px; background: var(--teal-wash); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.8"><path d="M9 3h6M10 3v5.5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8.5V3"/></svg>
      </div>
      <div>
        <p class="display" style="font-weight: 600; font-size: 16px; margin: 0;">Visão geral do projeto</p>
        <p style="font-size: 12px; color: var(--muted); margin: 2px 0 0;">Todas as áreas e colaboradores</p>
      </div>
    </div>
    <div class="charts-grid-3">
      <div class="card fade-in" style="padding: 15px 17px;">
        <p style="font-size: 12.5px; font-weight: 600; margin: 0 0 10px;">Tarefas por área</p>
        <div class="chart-box"><canvas id="c1" role="img" aria-label="Tarefas por área"></canvas></div>
      </div>
      <div class="card fade-in" style="padding: 15px 17px;">
        <p style="font-size: 12.5px; font-weight: 600; margin: 0 0 10px;">Status geral</p>
        <div style="display: flex; gap: 9px; flex-wrap: wrap;">${Object.keys(project.byStatus).length ? tilesHTML(project.byStatus, statusColor, statusTextColor) : chartEmpty("Nenhuma tarefa registrada.")}</div>
      </div>
      <div class="card fade-in" style="padding: 15px 17px;">
        <p style="font-size: 12.5px; font-weight: 600; margin: 0 0 10px;">Horas por funcionário</p>
        <div class="chart-box"><canvas id="c2" role="img" aria-label="Horas por funcionário"></canvas></div>
      </div>
    </div>
    <div class="card fade-in" style="padding: 15px 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <p style="font-size: 12.5px; font-weight: 600; margin: 0;">Tarefas mais urgentes</p>
        <button onclick="view='details'; renderAll();" style="border: none; background: transparent; color: var(--teal); font-size: 11.5px; cursor: pointer; padding: 0; font-weight: 500;">Ver detalhamento completo →</button>
      </div>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        ${people.flatMap(p => p.tasks.map(t => ({ ...t, assignee: p.name }))).length ? people.flatMap(p => p.tasks.map(t => ({ ...t, assignee: p.name }))).sort((a, b) => a.days - b.days).slice(0, 3).map(t => {
          const u = urgencyStyle(t);
          return `
          <div style="flex: 1; min-width: 160px; border: 1px solid var(--border); border-radius: 11px; padding: 11px 13px;">
            <p style="font-size: 12px; margin: 0 0 5px; line-height: 1.35; font-weight: 500;">${escapeHtml(t.title)}</p>
            <p style="font-size: 11px; color: var(--muted); margin: 0 0 7px;">${escapeHtml(t.assignee)}</p>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="num" style="font-size: 11px; color: var(--muted);">${t.due}</span>
              <span class="badge" style="background: ${u.bg}; color: ${u.color};">${remainingLabel(t)}</span>
            </div>
          </div>`;
        }).join("") : emptyState("Nenhuma tarefa por aqui ainda.")}
      </div>
    </div>`;

  if (chart1) chart1.destroy();
  chart1 = mountChart("c1", Object.keys(project.byArea).length > 0, () => ({
    type: "bar",
    data: { labels: Object.keys(project.byArea), datasets: [{ data: Object.values(project.byArea), backgroundColor: areaColor, borderRadius: 5, maxBarThickness: 22 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#EBF5F3" } }, x: { grid: { display: false } } } }
  }));

  if (chart2) chart2.destroy();
  chart2 = mountChart("c2", Object.keys(project.hoursByArea).length > 0, () => ({
    type: "bar",
    data: { labels: Object.keys(project.hoursByArea), datasets: [{ data: Object.values(project.hoursByArea), backgroundColor: hoursAreaColor, borderRadius: 5, maxBarThickness: 22 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        // title reads the full name straight from the original labels array by
        // index, not the abbreviated axis label, so hovering still reveals who
        // the bar actually represents.
        tooltip: { callbacks: { title: (items) => Object.keys(project.hoursByArea)[items[0].dataIndex], label: (ctx) => formatHoursMinutes(ctx.parsed.y) } }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: "#EBF5F3" } },
        x: {
          grid: { display: false },
          ticks: { callback: function (value) { return abbreviateNameLabel(this.getLabelForValue(value)); } }
        }
      } }
  }));
}

function renderAll() {
  Array.from(tabsEl.children).forEach(btn => {
    const active = btn.dataset.key === view;
    btn.style.background = active ? "#ffffff" : "transparent";
    btn.style.color = active ? "var(--teal)" : "var(--muted)";
    btn.style.fontWeight = active ? "600" : "500";
    btn.style.boxShadow = active ? "var(--shadow-sm)" : "none";
  });

  if (view === "details") {
    renderDetails();
  } else if (entity.type === "person") {
    renderPersonOverview(people[entity.index]);
  } else {
    renderProjectOverview();
  }

  // Pós-render: cascata dos cards, contagem dos KPIs e transição do #content.
  playContentSwap();
  staggerCards(contentEl);
  runCounters(contentEl);
}

["Visão geral", "Detalhamento de tarefas"].forEach((label, i) => {
  const key = i === 0 ? "overview" : "details";
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.dataset.key = key;
  btn.style.cssText = "border: none; padding: 8px 15px; border-radius: 9px; font-size: 12.5px; cursor: pointer; transition: background-color 120ms ease, color 120ms ease;";
  btn.onclick = () => { view = key; renderAll(); };
  tabsEl.appendChild(btn);
});

// Estado selecionado do colaborador na sidebar. O acento à esquerda (box-shadow
// inset, sem deslocar o layout) + texto teal em negrito tornam o item ativo
// visível "de relance", diferente do hover (só fundo teal-wash, sem acento).
function styleSidebarButton(btn, selected) {
  btn.style.background = selected ? "var(--teal-wash)" : "transparent";
  btn.style.boxShadow = selected ? "inset 3px 0 0 var(--teal)" : "none";
  btn.style.fontWeight = selected ? "700" : "500";
  btn.style.color = selected ? "var(--teal-deep)" : "var(--ink)";
}

function selectPerson(index) {
  entity = { type: "person", index };
  projectBtn.style.background = "transparent";
  projectBtn.style.color = "var(--teal)";
  projectBtn.style.borderColor = "var(--border)";
  Array.from(listEl.children).forEach((btn, i) => styleSidebarButton(btn, i === index));
  renderAll();
}

function selectProject() {
  entity = { type: "project" };
  projectBtn.style.background = "var(--teal)";
  projectBtn.style.color = "#ffffff";
  projectBtn.style.borderColor = "var(--teal)";
  Array.from(listEl.children).forEach(btn => styleSidebarButton(btn, false));
  renderAll();
}

/* ─────────────────────────────────────────────────────────────────
   Autenticação
   ───────────────────────────────────────────────────────────────── */
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const authInfo = document.getElementById("auth-info");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authSubmit = document.getElementById("auth-submit");
const authToggle = document.getElementById("auth-toggle");
const passwordToggle = document.getElementById("password-toggle");
const emailError = document.getElementById("email-error");
const passwordHint = document.getElementById("password-hint");
const signupWarning = document.getElementById("signup-warning");
const logoutBtn = document.getElementById("logout-btn");

let authMode = "login";
// Task 4: guarda o e-mail para o qual já mostramos o aviso "não cadastrado".
// Reenviar o mesmo e-mail confirma a intenção e deixa o cadastro seguir.
let signupWarnEmail = null;

// Validação no cliente (Task 7). Email: RFC-5322-lite. Senha (só no cadastro):
// pelo menos uma letra e um número, mínimo de 6 (mínimo padrão do Supabase).
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;

const EYE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>`;

function validateEmail(show) {
  const ok = EMAIL_RE.test(authEmail.value.trim());
  if (!ok && show && authEmail.value.trim() !== "") {
    emailError.textContent = "E-mail inválido";
    emailError.style.display = "block";
  } else {
    emailError.style.display = "none";
  }
  return ok;
}

function validatePassword(show) {
  const ok = PASSWORD_RE.test(authPassword.value);
  if (authMode !== "signup") {
    passwordHint.style.display = "none";
    return ok;
  }
  if (authPassword.value === "" && !show) {
    passwordHint.style.display = "none";
  } else if (ok) {
    passwordHint.textContent = "Senha válida.";
    passwordHint.style.color = "var(--done-ink)";
    passwordHint.style.display = "block";
  } else if (show || authPassword.value !== "") {
    passwordHint.textContent = "Use ao menos 6 caracteres, com pelo menos uma letra e um número.";
    passwordHint.style.color = "var(--late)";
    passwordHint.style.display = "block";
  } else {
    passwordHint.style.display = "none";
  }
  return ok;
}

function setSubmitLoading(loading) {
  authSubmit.disabled = loading;
  authSubmit.classList.toggle("is-loading", loading);
}

// Pequena transição ao alternar entre entrar/cadastrar (Task 4).
function pulseSwap(el) {
  if (prefersReducedMotion()) return;
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "authSwap 200ms ease both";
}

function setAuthMode(mode) {
  authMode = mode;
  authError.style.display = "none";
  authInfo.style.display = "none";
  emailError.style.display = "none";
  passwordHint.style.display = "none";
  if (signupWarning) signupWarning.style.display = "none";
  if (mode === "login") {
    authTitle.textContent = "Entrar";
    authSubtitle.textContent = "Use o e-mail cadastrado no time.";
    authSubmit.textContent = "Entrar";
    authToggle.textContent = "Ainda não tenho conta — criar acesso";
    authPassword.setAttribute("autocomplete", "current-password");
  } else {
    authTitle.textContent = "Criar acesso";
    authSubtitle.textContent = "Seu e-mail precisa já estar cadastrado em funcionarios.";
    authSubmit.textContent = "Criar conta";
    authToggle.textContent = "Já tenho conta — entrar";
    authPassword.setAttribute("autocomplete", "new-password");
  }
  [authTitle, authSubtitle, authSubmit, authToggle].forEach(pulseSwap);
}

authToggle.onclick = () => {
  // Task 1.2: nunca carregar input digitado de um modo para o outro. Limpamos
  // só os VALORES — as mensagens de validação são reavaliadas por setAuthMode.
  authEmail.value = "";
  authPassword.value = "";
  signupWarnEmail = null;
  setAuthMode(authMode === "login" ? "signup" : "login");
};

if (passwordToggle) {
  passwordToggle.innerHTML = EYE_ICON;
  passwordToggle.onclick = () => {
    const reveal = authPassword.type === "password";
    authPassword.type = reveal ? "text" : "password";
    passwordToggle.innerHTML = reveal ? EYE_OFF_ICON : EYE_ICON;
    passwordToggle.setAttribute("aria-label", reveal ? "Ocultar senha" : "Mostrar senha");
  };
}

authEmail.addEventListener("blur", () => validateEmail(true));
authEmail.addEventListener("input", () => {
  if (emailError.style.display === "block") validateEmail(true);
  // Mudou o e-mail: o aviso "não cadastrado" precisa ser reavaliado.
  if (signupWarning) signupWarning.style.display = "none";
  signupWarnEmail = null;
});
authPassword.addEventListener("input", () => validatePassword(false));

authForm.onsubmit = async (event) => {
  event.preventDefault();
  authError.style.display = "none";
  authInfo.style.display = "none";

  const emailOk = validateEmail(true);
  const passwordOk = validatePassword(true);

  // No cadastro, bloqueia antes de chamar o Supabase se algo estiver inválido.
  // No login, o aviso inline basta — a conta pode existir mesmo assim.
  if (authMode === "signup" && (!emailOk || !passwordOk)) return;

  const email = authEmail.value.trim();
  const password = authPassword.value;

  // Marca se realmente chamamos o Supabase (para limpar os campos só nesse
  // caso — Task 1.1). Um soft-block do aviso do Task 4 NÃO conta como envio.
  let performedAuthCall = false;

  setSubmitLoading(true);
  try {
    if (authMode === "login") {
      performedAuthCall = true;
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange cuida de mostrar o app depois de logar.
    } else {
      // Task 4: aviso (não bloqueio) se o e-mail não estiver cadastrado em
      // funcionarios. Só na primeira vez para este e-mail — reenviar segue.
      if (signupWarnEmail !== email) {
        const { data: registered, error: rpcErr } =
          await supabaseClient.rpc("email_is_registered", { check_email: email });
        // Falha aberta: se a RPC não existir/der erro, não travamos o cadastro,
        // já que o controle de acesso real é o RLS, não este heads-up.
        if (!rpcErr && registered === false && signupWarning) {
          signupWarning.textContent = "Este e-mail ainda não está associado à Quimia. Você pode criar a conta mesmo assim — envie novamente para continuar.";
          signupWarning.style.display = "block";
          signupWarnEmail = email;
          return; // soft-block: o finally reabilita o botão, campos preservados.
        }
      }
      performedAuthCall = true;
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      authInfo.textContent = "Conta criada. Se a confirmação por e-mail estiver ativa no projeto, confira sua caixa de entrada antes de entrar.";
      authInfo.style.display = "block";
      setAuthMode("login");
    }
  } catch (err) {
    authError.textContent = err.message || "Não foi possível completar a ação.";
    authError.style.display = "block";
  } finally {
    setSubmitLoading(false);
    // Task 1.1: após um envio de verdade (sucesso ou erro), limpa os campos.
    // Não limpamos as mensagens de validação (o usuário ainda precisa lê-las).
    if (performedAuthCall) {
      authEmail.value = "";
      authPassword.value = "";
    }
  }
};

logoutBtn.onclick = async () => {
  await supabaseClient.auth.signOut();
};

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) {
    authScreen.style.display = "none";
    appScreen.style.display = "block";
    loadDashboardData();
  } else {
    appScreen.style.display = "none";
    authScreen.style.display = "flex";
  }
});

/* ─────────────────────────────────────────────────────────────────
   Busca de dados reais no Supabase, respeitando as políticas de RLS
   já configuradas — nenhuma checagem extra de permissão é necessária
   aqui, o Postgres já filtra o que cada sessão pode ver.
   ───────────────────────────────────────────────────────────────── */
const RING_COLORS = ["#1F6E74", "#3AA0C7", "#36C6C6", "#2CD195", "#61B8D8", "#58E4A9"];

function initials(name) {
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

function formatDatePtBr(isoDate) {
  if (!isoDate) return "—";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function daysRemaining(isoDate) {
  if (!isoDate) return null;
  const due = new Date(isoDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

function describePostgrestError(label, error) {
  const parts = [`${label}: ${error.message || "erro desconhecido"}`];
  if (error.details) parts.push(`Detalhes: ${error.details}`);
  if (error.hint) parts.push(`Dica: ${error.hint}`);
  if (error.code) parts.push(`Código: ${error.code}`);
  return parts.join(" — ");
}

// Deixa o cabeçalho sempre num estado resolvido — nunca preso em "Carregando…".
function setHeaderState(state, timestamp) {
  const lastUpdated = document.getElementById("last-updated");
  const progressLabel = document.getElementById("progress-label");
  if (state === "loading") {
    lastUpdated.textContent = "Carregando…";
    progressLabel.textContent = "—";
    document.getElementById("progress-bar").style.width = "0%";
  } else if (state === "error") {
    lastUpdated.textContent = "Erro ao carregar";
    progressLabel.textContent = "indisponível";
  } else if (state === "empty") {
    lastUpdated.textContent = "Sem dados";
    progressLabel.textContent = "—";
  } else {
    lastUpdated.textContent = timestamp;
  }
}

async function loadDashboardData() {
  setHeaderState("loading");

  const [funcionariosRes, tarefasRes, horasRes, funcionarioAreaRes] = await Promise.all([
    supabaseClient.from("funcionarios").select("id, canonical_name, clickup_email, clockify_email, photo_url"),
    supabaseClient.from("tarefas").select(`
      task_id, titulo, responsavel_id, area, prioridade, status, data_criacao, prazo, data_conclusao, tipo, criador, data_atualizacao,
      tarefa_etiqueta ( etiquetas ( nome ) )
    `).is("arquivada_em", null),
    supabaseClient.from("horas").select("entry_id, funcionario_id, data, horas"),
    supabaseClient.from("funcionario_area").select("funcionario_id, areas ( nome )"),
  ]);

  // Erros de query são avaliados de forma independente, para dizer exatamente
  // qual das consultas falhou e mostrar a mensagem/detalhe/dica reais.
  const queryErrors = [];
  if (funcionariosRes.error) queryErrors.push(describePostgrestError("Colaboradores (funcionarios)", funcionariosRes.error));
  if (tarefasRes.error) queryErrors.push(describePostgrestError("Tarefas (tarefas)", tarefasRes.error));
  if (horasRes.error) queryErrors.push(describePostgrestError("Horas (horas)", horasRes.error));
  if (funcionarioAreaRes.error) queryErrors.push(describePostgrestError("Áreas por colaborador (funcionario_area)", funcionarioAreaRes.error));

  if (queryErrors.length) {
    contentEl.innerHTML = errorState("Não foi possível carregar os dados", queryErrors);
    listEl.innerHTML = "";
    [funcionariosRes.error, tarefasRes.error, horasRes.error, funcionarioAreaRes.error].filter(Boolean).forEach(e => console.error(e));
    setHeaderState("error");
    return;
  }

  const funcionarios = funcionariosRes.data || [];
  const tarefas = tarefasRes.data || [];
  const horas = horasRes.data || [];
  const funcionarioAreas = funcionarioAreaRes.data || [];

  // Monta a lista de pessoas a partir de funcionarios, e agrega tarefas/horas por id.
  people = funcionarios.map((f, i) => {
    const myTasks = tarefas.filter(t => t.responsavel_id === f.id);
    const myHours = horas.filter(h => h.funcionario_id === f.id);

    const statusTally = {};
    const priorityTally = {};
    let lateCount = 0;

    const tasks = myTasks.map(t => {
      statusTally[t.status] = (statusTally[t.status] || 0) + 1;
      priorityTally[t.prioridade] = (priorityTally[t.prioridade] || 0) + 1;

      const remaining = daysRemaining(t.prazo);
      const done = t.data_conclusao != null;
      const isLate = !done && remaining !== null && remaining < 0;
      const noDueDate = t.prazo == null;
      if (isLate) lateCount += 1;

      return {
        id: t.task_id,
        title: t.titulo,
        status: t.status,
        priority: t.prioridade,
        due: formatDatePtBr(t.prazo),
        days: remaining === null ? 999 : remaining,
        noDueDate,
        done,
        late: isLate,
        tags: (t.tarefa_etiqueta || []).map(link => link.etiquetas?.nome).filter(Boolean),
      };
    });

    // Área da pessoa: vem da tabela de vínculo funcionario_area (com o nome
    // em areas) no Postgres — não é mais derivada das áreas das tarefas.
    const areas = funcionarioAreas
      .filter(fa => fa.funcionario_id === f.id)
      .map(fa => fa.areas?.nome)
      .filter(Boolean);

    // Horas por mês (últimos 3 meses com dado).
    const hoursByMonth = {};
    myHours.forEach(h => {
      const month = h.data ? h.data.slice(0, 7) : null;
      if (month) hoursByMonth[month] = (hoursByMonth[month] || 0) + Number(h.horas);
    });
    const sortedMonths = Object.keys(hoursByMonth).sort().slice(-3);
    const monthLabels = { "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez" };

    return {
      id: f.id,
      name: f.canonical_name,
      area: areas.join(", ") || "Sem área registrada",
      initials: initials(f.canonical_name),
      ringColor: RING_COLORS[i % RING_COLORS.length],
      photoUrl: f.photo_url || null, // pode ser NULL por bastante tempo (fotos são adicionadas aos poucos)
      status: statusTally,
      priority: priorityTally,
      kpis: {
        total: myTasks.length,
        done: myTasks.filter(t => t.data_conclusao != null).length,
        late: lateCount,
        hours: myHours.reduce((sum, h) => sum + Number(h.horas), 0),
      },
      months: sortedMonths.map(m => monthLabels[m.slice(5, 7)] || m),
      hoursSeries: sortedMonths.map(m => hoursByMonth[m]),
      tasks,
    };
  });

  // Agregados do projeto inteiro.
  const byArea = {};
  const byStatus = {};
  tarefas.forEach(t => {
    if (t.area) byArea[t.area] = (byArea[t.area] || 0) + 1;
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  });

  // "Horas por área" não existe no schema atual (horas está ligada só ao
  // funcionário e à data, não a uma tarefa/área específica) — no lugar,
  // mostramos horas por funcionário no gráfico equivalente do projeto.
  const hoursByPerson = {};
  people.forEach(p => { hoursByPerson[p.name] = p.kpis.hours; });

  project = { byArea, byStatus, hoursByArea: hoursByPerson };

  // Sem erro, porém sem nenhum colaborador: estado vazio calmo (não alarmante).
  if (funcionarios.length === 0) {
    listEl.innerHTML = "";
    contentEl.innerHTML = emptyState("Nenhum colaborador cadastrado ainda.");
    setHeaderState("empty");
    return;
  }

  const doneCount = tarefas.filter(t => t.data_conclusao != null).length;
  const totalCount = tarefas.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const progressLabel = document.getElementById("progress-label");
  progressLabel.innerHTML =
    `${doneCount} / ${totalCount} tarefas · <span class="num" style="color: var(--teal); font-weight: 600;"><span data-count-to="${pct}">0</span>%</span>`;
  runCounters(progressLabel);
  document.getElementById("progress-bar").style.width = pct + "%";

  setHeaderState("success",
    "Atualizado " + new Date().toLocaleDateString("pt-BR") + " · " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));

  listEl.innerHTML = "";
  people.forEach((p, i) => {
    const btn = document.createElement("button");
    btn.className = "sidebar-btn";
    btn.innerHTML = `${avatarHTML(p, 32)}<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(p.name)}</span>`;
    btn.onclick = () => selectPerson(i);
    listEl.appendChild(btn);
  });

  if (people.length > 0) selectPerson(0);
  else selectProject();
}

projectBtn.onclick = selectProject;
