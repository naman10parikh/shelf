/* web/app.js — shelf cockpit SPA (G1, the local cockpit). Vanilla JS, zero dependencies, no build.
 *
 * Wires the views to the read-only JSON endpoints in web/server.mjs:
 *   Brain browser     → /api/brain-files, /api/brain-file, /api/brain, /api/explain
 *   Run log           → /api/runs
 *   Eval scores       → /api/eval        (the golden-task suite + the L1/L2/L3 rollup, read from disk)
 *   Backend & cost    → /api/workloads, /api/backend, /api/cost   (two read-only analyzers)
 *   Ask the employee  → /api/explain-text (shells `shelf explain`, id OR free-text)
 *   Upload demo       → static (read-mostly: no live upload from the browser)
 * Read-mostly: no endpoint here mutates — there is no mint-live-url / upload / migrate button.
 * Server text is always rendered as text (esc); the only markup pass is lite **bold** over escaped text.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Minimal HTML-escape — all server text is rendered as text, never injected as markup. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Lightest possible markdown: escape, then bold **…** so headings/labels stand out. No HTML injection. */
function md(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => ({ error: `bad response (${res.status})` }));
  if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

/** The explainable brain-id shapes (clickable hits + the ask router). Section headings are NOT ids. */
const ID_RE = /^(S\d+|P-\d+|O-\d+|V-\d+|JTBD-?\d+|Dispute\s+[A-Za-z])$/;

/* --------------------------------------------------------------------- tabs --- */
function showView(name) {
  $$("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === name)));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  // Lazy-load each data view on first reveal (the brain artifact list loads at init).
  if (name === "runs" && !showView._runs) { showView._runs = true; loadRuns(); }
  if (name === "eval" && !showView._eval) { showView._eval = true; loadEval(); }
  if (name === "analyze" && !showView._analyze) { showView._analyze = true; loadWorkloadChips(); }
}

/* ------------------------------------------------------------ brain browser --- */
async function loadArtifactList() {
  try {
    const { files } = await getJson("/api/brain-files");
    const list = $("#artifact-list");
    list.innerHTML = "";
    files.forEach((f) => {
      const b = document.createElement("button");
      b.textContent = f.replace(/\.md$/, "");
      b.dataset.file = f;
      b.addEventListener("click", () => openArtifact(f, b));
      list.appendChild(b);
    });
  } catch (err) {
    $("#artifact-list").innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

async function openArtifact(name, btn) {
  $$("#artifact-list button").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
  const reader = $("#brain-reader");
  reader.innerHTML = `<span class="loading">Loading ${esc(name)}…</span>`;
  try {
    const { markdown } = await getJson(`/api/brain-file?name=${encodeURIComponent(name)}`);
    reader.innerHTML = `<pre>${md(markdown)}</pre>`;
  } catch (err) {
    reader.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

/** A brain hit carries {rank,score,file,node,heading}; clicking a node with an id reads it via explain. */
async function runBrainSearch() {
  const q = $("#brain-q").value.trim();
  if (!q) return;
  const hitsEl = $("#brain-hits");
  hitsEl.innerHTML = `<span class="loading">Searching the brain for "${esc(q)}"…</span>`;
  try {
    const { results } = await getJson(`/api/brain?q=${encodeURIComponent(q)}`);
    if (!results || !results.length) { hitsEl.innerHTML = `<span class="empty">No hits for "${esc(q)}".</span>`; return; }
    hitsEl.innerHTML = "";
    results.forEach((h) => {
      const row = document.createElement("div");
      row.className = "hit";
      const id = h.node ? esc(h.node) : "—";
      const score = Number.isFinite(h.score) ? Number(h.score).toFixed(1) : esc(h.score);
      row.innerHTML =
        `<span class="id">${id}</span>` +
        `<span class="heading">${esc(h.heading || h.file)}</span>` +
        `<span class="score">score ${score}</span>`;
      // Only nodes with an explainable id are clickable; section headings (node:null) are not.
      if (h.node && ID_RE.test(h.node)) {
        row.classList.add("clickable");
        row.addEventListener("click", () => readById(h.node));
      }
      hitsEl.appendChild(row);
    });
  } catch (err) {
    hitsEl.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

async function readById(id) {
  const reader = $("#brain-reader");
  reader.innerHTML = `<span class="loading">Reading ${esc(id)}…</span>`;
  try {
    const r = await getJson(`/api/explain?id=${encodeURIComponent(id)}`);
    reader.innerHTML = `<pre><strong>${esc(r.heading || r.id || id)}</strong>\n(${esc(r.file || "")})\n\n${md(r.body || "(no body)")}</pre>`;
    reader.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    reader.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

/* ----------------------------------------------------------------- run log --- */
async function loadRuns() {
  const wrap = $("#runs-wrap");
  try {
    const { runs } = await getJson("/api/runs?limit=80");
    if (!runs.length) { wrap.innerHTML = `<span class="empty">No runs logged yet — run a <code>shelf</code> command (e.g. <code>shelf cost estimate --egress-gb 10 --storage-gb 100</code>).</span>`; return; }
    const rows = runs
      .map((r) => {
        const trace = (r.traceId || "").slice(0, 12);
        const dur = typeof r.durationMs === "number" ? r.durationMs.toFixed(1) : "—";
        const okClass = r.outcome === "ok" ? "ok" : "bad";
        const cmd = [r.command, r.args].filter(Boolean).join(" ");
        return (
          `<tr>` +
          `<td class="mono">${esc((r.ts || "").replace("T", " ").replace(/\..*/, ""))}</td>` +
          `<td class="mono">${esc(cmd || "—")}</td>` +
          `<td class="mono">${esc(r.model || "—")}</td>` +
          `<td class="num">${esc(dur)} ms</td>` +
          `<td class="mono">${esc(trace)}…</td>` +
          `<td class="num">${esc(r.toolCount ?? "—")}</td>` +
          `<td><span class="badge ${okClass}">${esc(r.outcome || "—")}</span></td>` +
          `</tr>`
        );
      })
      .join("");
    wrap.innerHTML =
      `<table><thead><tr><th>when</th><th>command</th><th>model</th><th>duration</th><th>trace.id</th><th>tools</th><th>outcome</th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch (err) {
    wrap.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

/* -------------------------------------------------------------- eval scores --- */
async function loadEval() {
  const wrap = $("#eval-wrap");
  try {
    const { tasks, rollup } = await getJson("/api/eval");
    if (!tasks.length) { wrap.innerHTML = `<span class="empty">No golden tasks found (eval/golden/GT-*.json).</span>`; return; }
    const byLevel = rollup.byLevel || {};
    const head =
      `<div class="card" style="margin-bottom:16px"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">` +
      `<span class="badge amber">${esc(rollup.total)} golden tasks</span>` +
      `<span class="badge ok">${esc(rollup.ciBlocking)} CI-blocking</span>` +
      `<span class="badge">L1 × ${esc(byLevel.L1 ?? 0)}</span>` +
      `<span class="badge">L2 × ${esc(byLevel.L2 ?? 0)}</span>` +
      `<span class="badge">L3 × ${esc(byLevel.L3 ?? 0)}</span>` +
      `<span class="num" style="font-size:12px;color:var(--text-faint)">L1 structural · L2 golden · L3 judge — the eval pyramid (run via <code>shelf eval</code>)</span>` +
      `</div></div>`;
    const rows = tasks
      .map((t) => {
        const levels = (t.levels || []).map((lv) => `<span class="badge">${esc(lv)}</span>`).join(" ");
        const ci = t.ciBlocking ? `<span class="badge ci">blocks CI</span>` : `<span class="badge">non-blocking</span>`;
        return (
          `<tr>` +
          `<td class="mono" style="color:var(--amber)">${esc(t.id)}</td>` +
          `<td class="mono">${esc(t.scenario)}</td>` +
          `<td>${esc(t.title)}</td>` +
          `<td>${levels}</td>` +
          `<td class="num">${esc(t.checks)}</td>` +
          `<td>${ci}</td>` +
          `</tr>`
        );
      })
      .join("");
    wrap.innerHTML =
      head +
      `<div class="card"><table><thead><tr><th>id</th><th>scenario</th><th>title</th><th>levels</th><th>checks</th><th>gate</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch (err) {
    wrap.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

/* ------------------------------------------------ backend & cost analyzer --- */
async function loadWorkloadChips() {
  const wrap = $("#workload-chips");
  try {
    const { workloads } = await getJson("/api/workloads");
    wrap.innerHTML = "";
    workloads.forEach((w) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = w;
      b.dataset.workload = w;
      b.addEventListener("click", () => pickBackend(w, b));
      wrap.appendChild(b);
    });
  } catch (err) {
    wrap.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

async function pickBackend(workload, btn) {
  $$("#workload-chips button").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
  const out = $("#backend-result");
  out.innerHTML = `<span class="loading">Picking a backend for ${esc(workload)}…</span>`;
  try {
    const r = await getJson(`/api/backend?workload=${encodeURIComponent(workload)}`);
    out.innerHTML =
      `<div class="pick-head"><span class="badge amber">${esc(r.workload)}</span> → <span class="pick-backend">${esc(r.backend)}</span></div>` +
      (r.why ? `<div class="pick-why">${esc(r.why)}</div>` : "") +
      (r.flipWhen ? `<div class="pick-flip"><span class="flip-label">flips when:</span> ${esc(r.flipWhen)}</div>` : "") +
      (r.default ? `<div class="pick-default">${esc(r.default)}</div>` : "");
  } catch (err) {
    out.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

async function estimateCost() {
  const egress = $("#cost-egress").value.trim();
  const storage = $("#cost-storage").value.trim();
  const out = $("#cost-result");
  out.innerHTML = `<span class="loading">Running the egress-first flip math…</span>`;
  try {
    const r = await getJson(`/api/cost?egressGb=${encodeURIComponent(egress)}&storageGb=${encodeURIComponent(storage)}`);
    const cell = (p) =>
      `<div class="cost-card ${r.cheaperForThisWorkload === p.provider ? "cheaper" : ""}">` +
      `<div class="cost-provider">${esc(p.provider)}${r.cheaperForThisWorkload === p.provider ? ` <span class="badge ok">cheaper</span>` : ""}</div>` +
      `<div class="cost-total num">$${esc(Number(p.totalUsdMo).toFixed(2))}<span class="cost-unit">/mo</span></div>` +
      `<div class="cost-break num">storage $${esc(Number(p.storageUsd).toFixed(2))} · egress $${esc(Number(p.egressUsd).toFixed(2))}</div>` +
      `</div>`;
    out.innerHTML =
      `<div class="cost-compare">${cell(r.r2)}${cell(r.s3)}</div>` +
      (r.flipNote ? `<div class="cost-flip">${esc(r.flipNote)}</div>` : "") +
      (r.caveat ? `<div class="cost-caveat">${esc(r.caveat)}</div>` : "");
  } catch (err) {
    out.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

/* ------------------------------------------------------- ask the employee --- */
async function ask() {
  const q = $("#ask-q").value.trim();
  if (!q) return;
  const out = $("#ask-answer");
  out.innerHTML = `<span class="loading">Asking shelf…</span>`;
  try {
    const r = await getJson(`/api/explain-text?q=${encodeURIComponent(q)}`);
    // `shelf explain` returns either {id,file,heading,body} (id match) or
    // {query,matched,file,heading,body,alternatives} (free-text). Render both shapes.
    const label = r.id || r.matched || (r.query ? "top match" : "");
    const headLine = [label, r.file].filter(Boolean).map(esc).join(" · ");
    const heading = r.heading ? `<div style="color:var(--text);margin-bottom:8px">${esc(r.heading)}</div>` : "";
    const body = r.body
      ? `<pre style="margin:0;white-space:pre-wrap;font-family:var(--mono);font-size:12.5px;line-height:1.7;color:var(--text-dim)">${md(r.body)}</pre>`
      : "";
    const alts = Array.isArray(r.alternatives) && r.alternatives.length
      ? `<div style="margin-top:12px">${r.alternatives
          .map((a) => `<div class="hit"><span class="id">${esc(a.node || "—")}</span><span class="heading">${esc(a.heading || a.file)}</span><span class="score">score ${esc(Number(a.score).toFixed(1))}</span></div>`)
          .join("")}</div>`
      : "";
    out.innerHTML =
      `<div class="card">` +
      (headLine ? `<div class="mono" style="color:var(--amber);margin-bottom:6px">${headLine}</div>` : "") +
      heading +
      body +
      `</div>` +
      alts +
      boundaryNote();
  } catch (err) {
    out.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

function boundaryNote() {
  return `<div class="boundary-note">Boundary: shelf owns <strong>object storage + file-handling + CDN + uploads</strong> only. Presigned-URL minting + live upload + cross-provider migration run from the <strong>CLI</strong> (creds-bearing), never from this read-mostly cockpit.</div>`;
}

/* ------------------------------------------------------------------- init --- */
function init() {
  $$("nav.tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#brain-go").addEventListener("click", runBrainSearch);
  $("#brain-q").addEventListener("keydown", (e) => { if (e.key === "Enter") runBrainSearch(); });
  $("#ask-go").addEventListener("click", ask);
  $("#ask-q").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
  $("#cost-go").addEventListener("click", estimateCost);
  $$("#cost-egress, #cost-storage").forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") estimateCost(); }));
  loadArtifactList();
}

document.addEventListener("DOMContentLoaded", init);
