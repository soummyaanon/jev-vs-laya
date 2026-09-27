"use strict";
// Jev vs Laya arena UI. Vanilla JS, talks only to the local arena backend.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? "–" : Number(x).toFixed(d));
const pct = (x) => (x == null ? "–" : (x * 100).toFixed(1) + "%");
const ms = (x) => (x == null ? "–" : Math.round(x) + "ms");
const COLOR = { jev: "var(--jev)", laya: "var(--laya)", "laya-typed": "var(--laya-typed)" };

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { "content-type": "application/json" }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const NOTES = [
  { id: "battleground", file: "battleground", folder: "run", blurb: "One click runs every game for every selected contender, then builds a report card you can download and post." },
  { id: "triage", file: "triage-duel", folder: "game", blurb: "Support tickets with hand-labelled gold. Four questions per ticket: department, urgency, churn risk, refund requested." },
  { id: "language", file: "language-gauntlet", folder: "game", blurb: "Five tickets, each in English, Hindi, Hinglish, Bengali, French, Arabic and Swahili. Scored per language." },
  { id: "jailbreak", file: "prompt-safety", folder: "game", blurb: "Benign prompts mixed with injection, persona and data-leak attempts. Watch the false-positive rate on benign ones." },
  { id: "bigmenu", file: "big-menu", folder: "game", blurb: "One choice with 50 banking intents. Jev's home turf; Laya plays this as a handicap round (guide rule 3)." },
  { id: "snake", file: "snake-duel", folder: "live", blurb: "Two snakes on identically seeded 12×12 boards. Every tick asks each model for a move. Longest survivor wins." },
  { id: "speed", file: "speed-race", folder: "live", blurb: "The same single-question call, repeated. p50 / p95 latency per contender. Warm both up first." },
  { id: "blind", file: "blind-arena", folder: "live", blurb: "Names hidden, order randomised. Pick the better answer; votes feed an Elo rating." },
  { id: "scoreboard", file: "scoreboard", folder: "live", blurb: "Everything recorded so far, across every game." },
];

const S = {
  meta: null, enabled: new Set(["jev", "laya"]), tabs: ["triage", "scoreboard"], view: "triage",
  results: {}, sel: null, running: false, stop: false, health: {}, snake: null, speed: {},
};
try { const e = JSON.parse(localStorage.getItem("arena.enabled")); if (Array.isArray(e) && e.length) S.enabled = new Set(e); } catch {}

const enabled = () => Object.keys(S.meta.contenders).filter((c) => S.enabled.has(c));
const label = (c) => S.meta.contenders[c]?.label ?? c;
const who = (c) => `<span class="who ${c}">${esc(label(c))}</span>`;

// ------------------------------------------------------------------ tooltip
const tip = $("#tip");
function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; moveTip(e); }
function moveTip(e) {
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8);
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function hideTip() { tip.hidden = true; }
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest("[data-tip]");
  if (t) showTip(e, t.dataset.tip); else if (!tip.hidden && !e.target.closest("svg.chart")) hideTip();
});

// ------------------------------------------------------------------ shell
function renderVault() {
  const games = S.meta.games;
  const FOLDERS = { run: "arena", game: "games", live: "live" };
  $("#notes").innerHTML = Object.keys(FOLDERS).map((f) =>
    `<div class="folder">${FOLDERS[f]}</div>` +
    NOTES.filter((n) => n.folder === f).map((n) => `
      <button class="note" data-open="${n.id}" aria-current="${S.view === n.id}">
        <span>${esc(n.file)}<span class="ext">.md</span></span>
        ${games[n.id] ? `<span class="count">${games[n.id].rounds.length}</span>` : ""}
      </button>`).join("")).join("");
  $("#contenders").innerHTML = Object.entries(S.meta.contenders).map(([k, c]) => `
    <label class="chk"><input type="checkbox" id="ct-${k}" data-ct="${k}" ${S.enabled.has(k) ? "checked" : ""}>
      <span class="swatch" style="background:${COLOR[k]}"></span>${esc(c.label)}<small>${esc(c.host)}</small></label>`).join("");
  $("#vault-count").textContent = `${NOTES.length} notes`;
}

function renderTabs() {
  $("#tabs").innerHTML = S.tabs.map((id) => {
    const n = NOTES.find((x) => x.id === id);
    return `<button class="tab" role="tab" data-open="${id}" aria-selected="${S.view === id}">${esc(n.file)}
      <span class="hint" data-close="${id}" title="Close tab">×</span></button>`;
  }).join("");
}

function open(id) {
  if (!S.tabs.includes(id)) S.tabs.push(id);
  S.view = id; S.sel = null;
  history.replaceState(null, "", "#" + id);
  renderVault(); renderTabs(); render();
  $("#editor").scrollTop = 0;
}

document.addEventListener("click", (e) => {
  const close = e.target.closest("[data-close]");
  if (close) {
    e.stopPropagation();
    const id = close.dataset.close;
    S.tabs = S.tabs.filter((t) => t !== id);
    if (!S.tabs.length) S.tabs = ["scoreboard"];
    if (S.view === id) S.view = S.tabs[S.tabs.length - 1];
    renderTabs(); renderVault(); render();
    return;
  }
  const o = e.target.closest("[data-open]");
  if (o) open(o.dataset.open);
});
document.addEventListener("change", (e) => {
  const c = e.target.dataset?.ct;
  if (!c) return;
  e.target.checked ? S.enabled.add(c) : S.enabled.delete(c);
  try { localStorage.setItem("arena.enabled", JSON.stringify([...S.enabled])); } catch {}
  render();
});

function header(n, props = []) {
  return `<div class="crumbs">jev-vs-laya / ${({ game: "games", live: "live", run: "arena" })[n.folder]} / <b>${esc(n.file)}.md</b></div>
    <div><h1><span class="hash">#</span>${esc(S.meta.games[n.id]?.title ?? n.file.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()))}</h1>
    <p class="lede">${esc(n.blurb)}</p>
    <div class="props">${props.map(([k, v]) => `<span class="prop">${esc(k)}: <b>${esc(v)}</b></span>`).join("")}</div></div>`;
}

function render() {
  const n = NOTES.find((x) => x.id === S.view);
  document.querySelector(".app").classList.toggle("focus", n.id === "battleground");
  const doc = $("#doc");
  if (S.meta.games[n.id]) renderGame(n, doc);
  else ({ battleground: renderSim, snake: renderSnake, speed: renderSpeed, blind: renderBlind, scoreboard: renderScoreboard })[n.id](n, doc);
}

// ------------------------------------------------------------------ games
function summarize(res, questions) {
  if (res.error) return `<span class="no">error</span> <span class="dim">${esc(res.error.slice(0, 90))}</span>`;
  return Object.keys(questions).map((q) => {
    const a = res.answers?.[q] || {};
    const g = res.grade?.[q];
    const v = a.type === "choice" ? a.choice : a.type === "score" ? fmt(a.score) : a.type === "noul" ? fmt(a.noul) : "?";
    const mark = g ? (g.correct ? `<span class="ok">✓</span>` : `<span class="no">✗</span>`) : "";
    return `<span><span class="dim">${esc(q)}=</span>${esc(v)}${mark}</span>`;
  }).join("") + `<span class="dim">${ms(res.latency_ms)}</span>`;
}

function roundLines(game, rounds) {
  const store = S.results[game] || {};
  return rounds.map((r, i) => {
    const got = store[i];
    const text = typeof r.state === "string" ? r.state : JSON.stringify(r.state);
    const subs = got ? enabled().filter((c) => got[c]).map((c) => `
      <div class="line"><span class="ln"></span><span class="sub">${who(c)} ${summarize(got[c], r.questions)}</span></div>`).join("") : "";
    return `<div class="line clickable ${S.sel === i ? "sel" : ""}" data-round="${i}">
        <span class="ln">${String(i + 1).padStart(3, "0")}</span>
        <span class="quote"><span class="prompt">❯ </span>${r.tag ? `<span class="dim">[${esc(r.tag)}] </span>` : ""}${esc(text)}</span>
      </div>${subs}`;
  }).join("");
}

async function gameStats(game) {
  const sb = await api(`/api/scoreboard?game=${game}`);
  return sb.contenders;
}

function statsTable(stats, cols) {
  const cs = enabled().filter((c) => stats[c]);
  if (!cs.length) return `<div class="hint">No results yet. Run the game to fill this in.</div>`;
  const best = {};
  for (const [key, , dir] of cols) {
    if (!dir) continue;
    const vals = cs.map((c) => stats[c][key]).filter((v) => v != null);
    if (vals.length > 1) best[key] = dir === "max" ? Math.max(...vals) : Math.min(...vals);
  }
  return `<div class="scroll-x"><table class="grid"><thead><tr><th>contender</th>${cols.map(([, h]) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
    ${cs.map((c) => `<tr><td>${who(c)}</td>${cols.map(([k, , dir, f]) => {
      const v = stats[c][k];
      return `<td class="${dir && v != null && v === best[k] ? "best" : ""}">${(f || fmt)(v)}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;
}

const GAME_COLS = [
  ["accuracy", "accuracy", "max", pct], ["p_true", "p(true)", "max", fmt], ["brier", "brier ↓", "min", (x) => fmt(x, 3)],
  ["score_mae", "score mae ↓", "min", fmt], ["p50", "p50", "min", ms], ["p95", "p95", "min", ms],
  ["error_rate", "errors", "min", pct], ["calls", "calls", null, (x) => x ?? "–"],
];

function langTable(stats) {
  const cs = enabled().filter((c) => stats[c]);
  const langs = [...new Set(cs.flatMap((c) => Object.keys(stats[c].by_tag || {})))];
  if (!langs.length) return "";
  return `<div class="callout"><div class="callout-title">accuracy by language</div><div class="scroll-x"><table class="grid">
    <thead><tr><th>contender</th>${langs.map((l) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>
    ${cs.map((c) => `<tr><td>${who(c)}</td>${langs.map((l) => `<td>${pct(stats[c].by_tag[l])}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div></div>`;
}

async function renderGame(n, doc) {
  const g = S.meta.games[n.id];
  if (!S.results[n.id]) {
    S.results[n.id] = {};
    try { for (const [i, v] of Object.entries(await api(`/api/results/${n.id}`))) S.results[n.id][+i] = v; } catch {}
    if (S.view !== n.id) return;
  }
  const qs = g.rounds[0].questions;
  const done = Object.keys(S.results[n.id] || {}).length;
  doc.innerHTML = `${header(n, [["rounds", g.rounds.length], ...Object.entries(qs).map(([k, q]) => [k, q.type + (q.type === "choice" ? ` ×${Object.keys(q.criteria).length}` : "")])])}
    <div class="toolbar">
      <button class="btn primary" id="run-all" ${S.running ? "disabled" : ""}>▶ Run all</button>
      <button class="btn" id="run-step" ${S.running ? "disabled" : ""}>Step</button>
      <button class="btn" id="run-stop" ${S.running ? "" : "disabled"}>■ Stop</button>
      <button class="btn" id="run-clear" ${S.running ? "disabled" : ""}>Clear results</button>
      <span class="hint">${enabled().map(label).join(" vs ") || "no contenders selected"} · each round sends byte-identical input</span>
    </div>
    <div class="callout"><div class="callout-title">scoreboard · ${esc(g.title)}</div><div id="gstats"><div class="hint">loading…</div></div></div>
    <div id="lang"></div>
    <div class="term"><div class="term-head"><span class="dots"><i></i><i></i><i></i></span>arena ~ ${esc(n.file)}
      <span class="right" id="progress">${done}/${g.rounds.length} played</span></div>
      <div class="term-body" id="log">${roundLines(n.id, g.rounds)}<div class="line"><span class="ln"></span><span class="dim ${S.running ? "cursor" : ""}">${S.running ? "running " : "click a round to inspect it "}</span></div></div></div>`;
  $("#run-all").onclick = () => runGame(n.id, false);
  $("#run-step").onclick = () => runGame(n.id, true);
  $("#run-stop").onclick = () => { S.stop = true; };
  $("#run-clear").onclick = async () => { await api(`/api/results?game=${n.id}`, { method: "DELETE" }); S.results[n.id] = {}; S.sel = null; render(); renderPanel(); };
  $("#log").onclick = (e) => { const l = e.target.closest("[data-round]"); if (l) { S.sel = +l.dataset.round; renderGame(n, doc); renderPanel(); } };
  refreshGameStats(n.id);
  renderPanel();
}

async function refreshGameStats(game) {
  try {
    const st = await gameStats(game);
    if (S.view !== game) return;
    $("#gstats").innerHTML = statsTable(st, GAME_COLS);
    if (game === "language") $("#lang").innerHTML = langTable(st);
  } catch (e) { $("#gstats").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

async function runGame(game, stepOnly) {
  const g = S.meta.games[game];
  const cs = enabled();
  if (!cs.length) return status("Select at least one contender in the vault sidebar.");
  S.results[game] ||= {};
  S.running = true; S.stop = false; render();
  const todo = g.rounds.map((_, i) => i).filter((i) => !cs.every((c) => S.results[game][i]?.[c]));
  for (const i of stepOnly ? todo.slice(0, 1) : todo) {
    if (S.stop) break;
    status(`${g.title}: round ${i + 1}/${g.rounds.length}`);
    try {
      const out = await api(`/api/games/${game}/${i}`, { method: "POST", body: { contenders: cs } });
      S.results[game][i] = { ...(S.results[game][i] || {}), ...Object.fromEntries(out.results.map((r) => [r.contender, r])) };
      S.sel = i;
      for (const r of out.results) noteLatency(r);
    } catch (e) { status(`round ${i + 1} failed: ${e.message}`); break; }
    if (S.view === game) {
      $("#log").innerHTML = roundLines(game, g.rounds) + `<div class="line"><span class="ln"></span><span class="dim cursor">running </span></div>`;
      $("#progress").textContent = `${Object.keys(S.results[game]).length}/${g.rounds.length} played`;
      const sel = $(`[data-round="${i}"]`); sel?.scrollIntoView({ block: "nearest" });
      renderPanel(); refreshGameStats(game);
    }
  }
  S.running = false;
  status(S.stop ? "stopped" : `${g.title}: done`);
  if (S.view === game) render();
}

// ------------------------------------------------------------------ detail panel
function probRows(q, answers, gold) {
  const cs = enabled().filter((c) => answers[c] && !answers[c].error);
  if (q.type === "noul") {
    return `<div class="probrow"><span class="opt ${gold === true ? "is-gold" : ""}">yes</span><div class="bars">${cs.map((c) => bar(c, answers[c].answers?.[q._id]?.noul)).join("")}</div>
      <span class="val">${cs.map((c) => fmt(answers[c].answers?.[q._id]?.noul)).join("<br>")}</span></div>`;
  }
  const opts = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
  const names = q.type === "choice" ? opts : q.criteria;
  return opts.map((o, i) => `<div class="probrow" data-tip="${esc(q.type === "choice" ? q.criteria[o] : names[i])}">
      <span class="opt ${String(gold) === o ? "is-gold" : ""}">${esc(q.type === "choice" ? o : `${o} · ${names[i]}`)}</span>
      <div class="bars">${cs.map((c) => bar(c, answers[c].answers?.[q._id]?.probabilities?.[o])).join("")}</div>
      <span class="val">${cs.map((c) => fmt(answers[c].answers?.[q._id]?.probabilities?.[o])).join("<br>")}</span></div>`).join("");
}
function bar(c, p) {
  const w = Math.max(0, Math.min(1, p ?? 0)) * 100;
  return `<div class="bartrack"><div class="bar" style="--c:${COLOR[c]};width:${w}%" data-tip="${esc(label(c))}: ${fmt(p)}"></div></div>`;
}

function renderPanel() {
  const panel = $("#panel");
  const g = S.meta.games[S.view];
  if (!g || S.sel == null) {
    panel.innerHTML = `<div class="panel-title"><span>round detail</span></div>
      <div class="hint">${g ? "Pick a round in the log to see each model's probabilities next to the gold label." : "Detail appears here while you play a scored game."}</div>
      <div class="legend">${enabled().map((c) => `<span><i class="swatch" style="background:${COLOR[c]}"></i>${esc(label(c))}</span>`).join("")}</div>`;
    return;
  }
  const r = g.rounds[S.sel];
  const got = (S.results[S.view] || {})[S.sel] || {};
  const cs = enabled();
  panel.innerHTML = `<div class="panel-title"><span>round ${S.sel + 1}${r.tag ? ` · ${esc(r.tag)}` : ""}</span><span class="hint">gold in amber</span></div>
    <div class="state-box">${esc(typeof r.state === "string" ? r.state : JSON.stringify(r.state, null, 2))}</div>
    <div class="legend">${cs.map((c) => `<span><i class="swatch" style="background:${COLOR[c]}"></i>${esc(label(c))} ${got[c] ? `<span class="dim">${ms(got[c].latency_ms)}${got[c].routed ? " · " + esc(got[c].routed) : ""}</span>` : `<span class="dim">not run</span>`}</span>`).join("")}</div>
    ${cs.filter((c) => got[c]?.error).map((c) => `<div class="err">${esc(label(c))}: ${esc(got[c].error)}</div>`).join("")}
    ${Object.entries(r.questions).map(([id, q]) => `<div class="qblock">
      <div class="qhead"><span class="qid">${esc(id)}</span><span class="type">${esc(q.type)}</span></div>
      <div class="hint">${esc(q.instructions)}</div>
      <div class="gold">gold: ${esc(String(r.gold[id]))}</div>
      ${probRows({ ...q, _id: id }, got, r.gold[id])}
      <div class="hint">${cs.filter((c) => got[c]?.answers?.[id]?.confidence != null).map((c) => `${esc(label(c))} conf ${fmt(got[c].answers[id].confidence)}`).join(" · ")}</div>
    </div>`).join("")}
    <div class="hint">Confidence formulas differ between the two models, so the scoreboard ranks by p(true) instead (guide rule 1).</div>`;
}

// ------------------------------------------------------------------ snake
const W = 12, H = 12;
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function newSnake(seed) {
  const s = { body: [[5, 6], [4, 6], [3, 6]], dir: "right", rand: rng(seed), eaten: 0, ticks: 0, alive: true, lat: [], death: null, why: "" };
  placeFood(s); return s;
}
function placeFood(s) {
  do { s.food = [Math.floor(s.rand() * W), Math.floor(s.rand() * H)]; }
  while (s.body.some(([x, y]) => x === s.food[0] && y === s.food[1]));
}
const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function renderSnake(n, doc) {
  const cs = enabled();
  if (!S.snake || S.snake.seed == null) S.snake = { seed: 42, max: 150, boards: {}, running: false };
  const sn = S.snake;
  for (const c of cs) sn.boards[c] ||= newSnake(sn.seed);
  doc.innerHTML = `${header(n, [["board", `${W}×${H}`], ["tick limit", sn.max], ["question", "move · choice ×4"]])}
    <div class="toolbar">
      <button class="btn primary" id="sn-go" ${sn.running ? "disabled" : ""}>▶ Start duel</button>
      <button class="btn" id="sn-stop" ${sn.running ? "" : "disabled"}>■ Stop</button>
      <button class="btn" id="sn-reset" ${sn.running ? "disabled" : ""}>New board</button>
      <label class="hint" for="sn-seed">seed</label><input class="field" id="sn-seed" type="number" value="${sn.seed}" style="width:90px">
      <span class="hint">Each move costs one API call per snake.</span>
    </div>
    <div class="arenas">${cs.map((c) => `<div class="arena">
      <div class="arena-head"><span class="swatch" style="background:${COLOR[c]}"></span>${who(c)}<span class="stat" id="sn-stat-${c}"></span></div>
      <canvas id="sn-cv-${c}" width="360" height="360" aria-label="${esc(label(c))} snake board"></canvas>
      <div class="hint" id="sn-why-${c}"></div>
      <svg class="chart" id="sn-spark-${c}" viewBox="0 0 300 44" role="img" aria-label="latency per move"></svg>
    </div>`).join("")}</div>`;
  $("#sn-go").onclick = snakeLoop;
  $("#sn-stop").onclick = () => { sn.running = false; };
  $("#sn-reset").onclick = () => { sn.seed = +$("#sn-seed").value || 42; sn.boards = {}; renderSnake(n, doc); };
  for (const c of cs) drawSnake(c);
  renderPanel();
}

// Smooth motion: each segment glides from its old cell to its new one (the cell the segment
// ahead of it just left) over roughly one tick. Growth keeps the old tail in place.
const ANIM = new Map();
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

function drawSnake(c, s = S.snake?.boards[c], pre = "sn") {
  const cv = $(`#${pre}-cv-${c}`);
  if (!s || !cv) return;
  const key = cv.id, now = performance.now();
  const sig = s.body.map((p) => p.join(",")).join(";") + "|" + s.alive;
  let a = ANIM.get(key);
  if (!a || a.board !== s) {
    a = { board: s, from: s.body.map((p) => [...p]), to: s.body.map((p) => [...p]), t0: now, dur: 1, sig, last: now };
    ANIM.set(key, a);
  } else if (a.sig !== sig) {
    const t = Math.min(1, (now - a.t0) / a.dur);
    const shown = a.to.map((p, i) => lerpPt(a.from[Math.min(i, a.from.length - 1)], p, ease(t)));
    // Glide for about as long as the gap between ticks, so motion never stalls between moves.
    a.dur = REDUCED ? 1 : Math.max(90, Math.min(420, now - a.last));
    a.from = shown; a.to = s.body.map((p) => [...p]); a.t0 = now; a.sig = sig; a.last = now;
  }
  a.cv = cv; a.c = c;
  if (!a.raf) a.raf = requestAnimationFrame(function frame(ts) {
    const t = Math.min(1, (ts - a.t0) / a.dur);
    paintBoard(a.cv, a.c, a.board, a.to.map((p, i) => lerpPt(a.from[Math.min(i, a.from.length - 1)], p, ease(t))));
    a.raf = t < 1 && document.body.contains(a.cv) ? requestAnimationFrame(frame) : 0;
  });
  const avg = s.lat.length ? s.lat.reduce((a, b) => a + b, 0) / s.lat.length : null;
  $(`#${pre}-stat-${c}`).innerHTML = `${s.alive ? "" : `<span class="status-dead">dead · </span>`}food ${s.eaten} · ticks ${s.ticks} · avg ${ms(avg)}`;
  $(`#${pre}-why-${c}`).textContent = s.why;
  spark($(`#${pre}-spark-${c}`), s.lat, c);
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerpPt = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

// Minimal board: faint dot grid, the body is one rounded stroke, food is a small dot.
function paintBoard(cv, c, s, pts) {
  const x = cv.getContext("2d"), k = cv.width / W, mid = (v) => v * k + k / 2;
  x.fillStyle = "#121214"; x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = "#1d1d21";
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) { x.beginPath(); x.arc(mid(i), mid(j), 1.2, 0, 7); x.fill(); }
  x.fillStyle = "#e8e8ec"; x.beginPath(); x.arc(mid(s.food[0]), mid(s.food[1]), k * 0.16, 0, 7); x.fill();
  const col = getComputedStyle(document.documentElement).getPropertyValue(`--${c}`).trim();
  x.globalAlpha = s.alive ? 1 : 0.35;
  x.strokeStyle = col; x.lineWidth = k * 0.56; x.lineCap = "round"; x.lineJoin = "round";
  x.beginPath();
  pts.forEach(([bx, by], i) => (i ? x.lineTo(mid(bx), mid(by)) : x.moveTo(mid(bx), mid(by))));
  if (pts.length === 1) x.lineTo(mid(pts[0][0]) + 0.1, mid(pts[0][1]));
  x.stroke();
  x.fillStyle = "#121214"; x.beginPath(); x.arc(mid(pts[0][0]), mid(pts[0][1]), k * 0.09, 0, 7); x.fill();
  x.globalAlpha = 1;
}

function spark(svg, xs, c) {
  if (!svg) return;
  if (xs.length < 2) { svg.innerHTML = `<text x="0" y="26">latency per move appears here</text>`; return; }
  const max = Math.max(...xs), w = 300, h = 44, top = 12;
  const pts = xs.map((v, i) => [(i / (xs.length - 1)) * (w - 40), top + (1 - v / max) * (h - top - 4)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  const [ex, ey] = pts[pts.length - 1];
  svg.innerHTML = `<line class="gridline" x1="0" x2="${w - 40}" y1="${h - 4}" y2="${h - 4}"/>
    <path d="${d} L${ex} ${h - 4} L0 ${h - 4}Z" fill="${COLOR[c]}" opacity=".12"/>
    <path d="${d}" fill="none" stroke="${COLOR[c]}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${ex}" cy="${ey}" r="3" fill="${COLOR[c]}" stroke="var(--bg)" stroke-width="2"/>
    <text x="${w - 34}" y="${Math.max(10, ey + 3)}">${Math.round(xs[xs.length - 1])}ms</text>
    <text x="0" y="9">max ${Math.round(max)}ms</text>`;
}

const DEATH = { wall: "hit the wall", body: "hit itself" };

// One move for one snake. Shared by the Snake note and the battleground.
async function snakeTick(s, c, run, board = 0) {
  try {
    const r = await api("/api/snake", { method: "POST", body: { contender: c, w: W, h: H, snake: s.body, food: s.food, direction: s.dir, run, board } });
    noteLatency(r);
    s.lat.push(r.latency_ms);
    if (r.error) { s.alive = false; s.death = "error"; s.why = "error: " + r.error.slice(0, 80); return; }
    const a = r.answers?.move || {};
    const mv = D[a.choice] ? a.choice : s.dir;
    const [dx, dy] = D[mv], [hx, hy] = s.body[0], nx = hx + dx, ny = hy + dy;
    s.dir = mv; s.ticks++;
    s.why = `→ ${mv} · ${r.options?.[mv] ?? ""} (p ${fmt(a.probabilities?.[mv])})`;
    const hitSelf = s.body.slice(0, -1).some(([bx, by]) => bx === nx && by === ny);
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || hitSelf) {
      s.alive = false; s.death = hitSelf ? "body" : "wall"; s.why += " · " + DEATH[s.death]; return;
    }
    s.body.unshift([nx, ny]);
    if (nx === s.food[0] && ny === s.food[1]) { s.eaten++; placeFood(s); } else s.body.pop();
  } catch (e) { s.alive = false; s.death = "error"; s.why = e.message; }
}

async function snakeLoop() {
  const sn = S.snake, cs = enabled().filter((c) => sn.boards[c]);
  sn.running = true; render();
  while (sn.running && cs.some((c) => sn.boards[c].alive && sn.boards[c].ticks < sn.max)) {
    await Promise.all(cs.map((c) => (sn.boards[c].alive && sn.boards[c].ticks < sn.max ? snakeTick(sn.boards[c], c) : null)));
    if (S.view === "snake") cs.forEach((c) => drawSnake(c));
  }
  sn.running = false;
  const best = [...cs].sort((a, b) => sn.boards[b].eaten - sn.boards[a].eaten || sn.boards[b].ticks - sn.boards[a].ticks)[0];
  status(`snake duel over · ${label(best)} leads with ${sn.boards[best].eaten} food`);
  if (S.view === "snake") render();
}

// ------------------------------------------------------------------ speed race
function renderSpeed(n, doc) {
  const cs = enabled();
  const sp = S.speed;
  sp.n ||= 50;
  const stats = (xs) => {
    if (!xs?.length) return {};
    const s = [...xs].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
    return { n: s.length, p50: q(0.5), p95: q(0.95), min: s[0], rps: 1000 / (s.reduce((a, b) => a + b, 0) / s.length) };
  };
  const st = Object.fromEntries(cs.map((c) => [c, stats(sp[c])]));
  doc.innerHTML = `${header(n, [["calls", "sequential"], ["question", "dept · choice ×2"]])}
    <div class="toolbar">
      <label class="hint" for="sp-n">calls per contender</label>
      <input class="field" id="sp-n" type="number" min="5" max="500" value="${sp.n}" style="width:90px">
      <button class="btn primary" id="sp-go" ${sp.running ? "disabled" : ""}>▶ Race</button>
      <button class="btn" id="sp-stop" ${sp.running ? "" : "disabled"}>■ Stop</button>
      <button class="btn" id="sp-warm" ${sp.running ? "disabled" : ""}>Warm up</button>
      <span class="hint">Laya runs on this Mac (MPS). The guide's 33ms figure is a T4 GPU.</span>
    </div>
    <div class="callout"><div class="callout-title">latency</div>${statsTable(st, [
      ["n", "calls", null, (x) => x ?? "–"], ["min", "min", "min", ms], ["p50", "p50", "min", ms], ["p95", "p95", "min", ms], ["rps", "calls/s", "max", (x) => fmt(x, 1)]])}</div>
    <div class="term"><div class="term-head"><span class="dots"><i></i><i></i><i></i></span>latency per call<span class="right legend">${cs.map((c) => `<span><i class="swatch" style="background:${COLOR[c]}"></i>${esc(label(c))}</span>`).join("")}</span></div>
      <div style="padding:12px"><svg class="chart" id="sp-chart" viewBox="0 0 720 240" role="img" aria-label="latency per call, one line per contender"></svg></div></div>`;
  $("#sp-go").onclick = speedRace;
  $("#sp-stop").onclick = () => { sp.running = false; };
  $("#sp-warm").onclick = warmup;
  $("#sp-n").onchange = (e) => { sp.n = Math.max(5, Math.min(500, +e.target.value || 50)); };
  lineChart($("#sp-chart"), cs.filter((c) => sp[c]?.length).map((c) => ({ c, xs: sp[c] })));
  renderPanel();
}

function lineChart(svg, series) {
  const w = 720, h = 240, L = 48, R = 12, T = 10, B = 24;
  if (!series.length) { svg.innerHTML = `<text x="${L}" y="${h / 2}">Press Race to plot each call's latency.</text>`; return; }
  const n = Math.max(...series.map((s) => s.xs.length));
  const max = Math.max(...series.flatMap((s) => s.xs)) * 1.1;
  const step = niceStep(max / 4);
  const X = (i) => L + (n > 1 ? (i / (n - 1)) * (w - L - R) : 0), Y = (v) => T + (1 - v / max) * (h - T - B);
  let g = "";
  for (let v = 0; v <= max; v += step) g += `<line class="gridline" x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${Math.round(v)}ms</text>`;
  g += `<text x="${L}" y="${h - 6}">call 1</text><text x="${w - R}" y="${h - 6}" text-anchor="end">call ${n}</text>`;
  for (const s of series) {
    const d = s.xs.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join("");
    g += `<path d="${d}" fill="none" stroke="${COLOR[s.c]}" stroke-width="2" stroke-linejoin="round"/>`;
    const li = s.xs.length - 1;
    g += `<circle cx="${X(li)}" cy="${Y(s.xs[li])}" r="3.5" fill="${COLOR[s.c]}" stroke="var(--bg)" stroke-width="2"/>`;
  }
  g += `<line id="xh" class="gridline" y1="${T}" y2="${h - B}" stroke-dasharray="3 3" visibility="hidden"/><rect x="${L}" y="${T}" width="${w - L - R}" height="${h - T - B}" fill="transparent" id="hit"/>`;
  svg.innerHTML = g;
  const hit = svg.querySelector("#hit"), xh = svg.querySelector("#xh");
  hit.onmousemove = (e) => {
    const r = svg.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * w;
    const i = Math.max(0, Math.min(n - 1, Math.round(((vx - L) / (w - L - R)) * (n - 1))));
    xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("visibility", "visible");
    showTip(e, `call ${i + 1}<br>` + series.map((s) => `${who(s.c)} ${ms(s.xs[i])}`).join("<br>"));
  };
  hit.onmouseleave = () => { xh.setAttribute("visibility", "hidden"); hideTip(); };
}
function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x || 1)); return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x) || p * 10; }

async function speedRace() {
  const sp = S.speed, cs = enabled();
  sp.running = true;
  for (const c of cs) sp[c] = [];
  render();
  for (let i = 0; i < sp.n && sp.running; i++) {
    for (const c of cs) {
      if (!sp.running) break;
      const r = await api("/api/speed", { method: "POST", body: { contender: c, i } });
      if (!r.error) sp[c].push(r.latency_ms);
      noteLatency({ contender: c, latency_ms: r.latency_ms });
    }
    if (S.view === "speed" && i % 2 === 0) lineChart($("#sp-chart"), cs.map((c) => ({ c, xs: sp[c] })));
    status(`speed race ${i + 1}/${sp.n}`);
  }
  sp.running = false;
  if (S.view === "speed") render();
  status("speed race done");
}

async function warmup() {
  status("warming up…");
  try {
    const r = await api("/api/warmup", { method: "POST", body: { contenders: enabled() } });
    status("warm-up: " + Object.entries(r).map(([c, l]) => `${label(c)} ${l.join("/")}ms`).join(" · "));
  } catch (e) { status("warm-up failed: " + e.message); }
}

// ------------------------------------------------------------------ blind arena
const BLIND_DEFAULT_STATE = "Hey, I've been charged for the Pro plan but my workspace still shows Free features. Also the invoice email went to my old address. Can someone fix this today?";
function renderBlind(n, doc) {
  const b = (S.blind ||= { state: BLIND_DEFAULT_STATE, qs: JSON.stringify(S.meta.games.triage.rounds[0].questions, null, 2), pair: null, out: null, revealed: false });
  doc.innerHTML = `${header(n, [["rating", "Elo, K=32"], ["start", "1000"]])}
    <div class="callout"><div class="callout-title">elo</div><div id="elo"><span class="hint">loading…</span></div></div>
    <div><h2><span class="hash">##</span>state</h2></div>
    <textarea class="field" id="bl-state" rows="4">${esc(b.state)}</textarea>
    <details><summary class="hint">questions (JSON, edit freely)</summary><textarea class="field" id="bl-qs" rows="14">${esc(b.qs)}</textarea></details>
    <div class="toolbar"><button class="btn primary" id="bl-go">▶ Run blind round</button><span class="hint">Two of your selected contenders, order shuffled. Latency is hidden so it can't give them away.</span></div>
    <div id="bl-out"></div>`;
  $("#bl-go").onclick = blindRound;
  $("#bl-state").oninput = (e) => { b.state = e.target.value; };
  $("#bl-qs").oninput = (e) => { b.qs = e.target.value; };
  drawBlind(); loadElo(); renderPanel();
}
async function loadElo() {
  const sb = await api("/api/scoreboard");
  if ($("#elo")) $("#elo").innerHTML = eloTable(sb.elo);
}
function eloTable(elo) {
  const rows = Object.entries(elo).filter(([c]) => S.meta.contenders[c]).sort((a, b) => b[1].elo - a[1].elo);
  return `<table class="grid"><thead><tr><th>contender</th><th>elo</th><th>votes</th></tr></thead><tbody>
    ${rows.map(([c, v]) => `<tr><td>${who(c)}</td><td>${v.elo}</td><td>${v.votes}</td></tr>`).join("")}</tbody></table>`;
}
async function blindRound() {
  const b = S.blind;
  let qs;
  try { qs = JSON.parse(b.qs); } catch (e) { return status("Questions aren't valid JSON: " + e.message); }
  const cs = enabled();
  if (cs.length < 2) return status("Select two contenders for the blind arena.");
  $("#bl-out").innerHTML = `<div class="hint cursor">asking both </div>`;
  try {
    b.pair = await api(`/api/random-pair?contenders=${cs.join(",")}`);
    const out = await api("/api/duel", { method: "POST", body: { state: b.state, questions: qs, contenders: [b.pair.a, b.pair.b], game: "blind" } });
    b.out = Object.fromEntries(out.results.map((r) => [r.contender, r]));
    b.qsParsed = qs; b.revealed = false;
    drawBlind();
  } catch (e) { $("#bl-out").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
function blindAnswer(r, qs) {
  if (r.error) return `<div class="err">${esc(r.error)}</div>`;
  return Object.entries(qs).map(([id, q]) => {
    const a = r.answers?.[id] || {};
    const main = a.type === "choice" ? a.choice : a.type === "score" ? `${fmt(a.score)} · ${q.criteria?.[Math.round(a.score)] ?? ""}` : a.type === "noul" ? `p(yes) ${fmt(a.noul)}` : "no answer";
    return `<div><span class="dim">${esc(id)}</span> ${esc(main)}</div>`;
  }).join("");
}
function drawBlind() {
  const b = S.blind, el = $("#bl-out");
  if (!el || !b.out) return;
  const side = (k, c) => `<div class="card"><div class="card-title">Output ${k}${b.revealed ? ` · ${who(c)} <span class="dim">${ms(b.out[c].latency_ms)}</span>` : ""}</div>${blindAnswer(b.out[c], b.qsParsed)}</div>`;
  el.innerHTML = `<div class="duo">${side("A", b.pair.a)}${side("B", b.pair.b)}</div>
    <div class="toolbar">${b.revealed ? `<span class="hint">Vote recorded.</span><button class="btn" id="bl-next">Next round</button>` :
      `<button class="btn" data-vote="a">A is better</button><button class="btn" data-vote="tie">Tie</button><button class="btn" data-vote="b">B is better</button>`}</div>`;
  el.querySelectorAll("[data-vote]").forEach((btn) => btn.onclick = async () => {
    const v = btn.dataset.vote, winner = v === "tie" ? "tie" : b.pair[v];
    const elo = await api("/api/vote", { method: "POST", body: { a: b.pair.a, b: b.pair.b, winner } });
    b.revealed = true; drawBlind();
    $("#elo").innerHTML = eloTable(elo);
  });
  $("#bl-next")?.addEventListener("click", blindRound);
}

// ------------------------------------------------------------------ scoreboard
async function renderScoreboard(n, doc) {
  doc.innerHTML = `${header(n, [["metrics", "accuracy · p(true) · brier · latency · tokens"]])}<div id="sb-body" class="hint">loading…</div>`;
  renderPanel();
  const games = Object.keys(S.meta.games);
  const [all, ...per] = await Promise.all([api("/api/scoreboard"), ...games.map((g) => api(`/api/scoreboard?game=${g}`))]);
  const cs = enabled();
  const accBy = games.map((g, i) => ({ g, title: S.meta.games[g].title, v: Object.fromEntries(cs.map((c) => [c, per[i].contenders[c]?.accuracy ?? null])) }));
  $("#sb-body").outerHTML = `
    <div class="callout"><div class="callout-title">all games</div>${statsTable(all.contenders, [...GAME_COLS, ["tokens", "tokens", null, (x) => x ?? "–"]])}</div>
    <div class="term"><div class="term-head"><span class="dots"><i></i><i></i><i></i></span>accuracy by game
      <span class="right legend">${cs.map((c) => `<span><i class="swatch" style="background:${COLOR[c]}"></i>${esc(label(c))}</span>`).join("")}</span></div>
      <div style="padding:12px"><svg class="chart" id="acc-chart" viewBox="0 0 720 230" role="img" aria-label="accuracy by game, grouped by contender"></svg></div></div>
    ${games.map((g, i) => `<div><h2><span class="hash">##</span>${esc(S.meta.games[g].title)}</h2></div>${statsTable(per[i].contenders, GAME_COLS)}`).join("")}
    <div><h2><span class="hash">##</span>Blind arena</h2></div>${eloTable(all.elo)}
    <p class="hint">Cost: Laya runs on your own hardware, so it costs nothing per call. Jev spend follows the tokens column at TypeSafe's per-token rate.</p>`;
  groupedBars($("#acc-chart"), accBy, cs);
}

function groupedBars(svg, groups, cs) {
  const w = 720, h = 230, L = 40, R = 8, T = 16, B = 28;
  const has = groups.some((g) => cs.some((c) => g.v[c] != null));
  if (!has) { svg.innerHTML = `<text x="${L}" y="${h / 2}">Play a game to chart accuracy here.</text>`; return; }
  const Y = (v) => T + (1 - v) * (h - T - B), gw = (w - L - R) / groups.length, bw = Math.min(28, (gw - 24) / cs.length);
  let s = "";
  for (let v = 0; v <= 1.001; v += 0.25) s += `<line class="gridline" x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${v * 100}%</text>`;
  groups.forEach((g, gi) => {
    const x0 = L + gi * gw + (gw - cs.length * (bw + 2)) / 2;
    cs.forEach((c, ci) => {
      const v = g.v[c];
      if (v == null) return;
      const x = x0 + ci * (bw + 2), y = Y(v), bh = Y(0) - y;
      s += `<path d="M${x} ${Y(0)}V${y + Math.min(4, bh)}q0 -4 4 -4h${bw - 8}q4 0 4 4V${Y(0)}Z" fill="${COLOR[c]}" data-tip="${esc(g.title)} · ${esc(label(c))}: ${pct(v)}"/>`;
      s += `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" style="fill:var(--text-2)">${Math.round(v * 100)}</text>`;
      s += `<rect x="${x - 1}" y="${T}" width="${bw + 2}" height="${h - T - B}" fill="transparent" data-tip="${esc(g.title)} · ${esc(label(c))}: ${pct(v)}"/>`;
    });
    s += `<text x="${L + gi * gw + gw / 2}" y="${h - 8}" text-anchor="middle">${esc(g.title)}</text>`;
  });
  svg.innerHTML = s;
}

// ------------------------------------------------------------------ status bar
const lastLat = {};
function noteLatency(r) { if (r?.contender) lastLat[r.contender] = r.latency_ms; renderStatus(); }
function status(msg) { $("#sb-left").textContent = msg; }
function renderStatus() {
  const bar = $("#statusbar"), left = $("#sb-left");
  bar.innerHTML = "";
  bar.append(left);
  for (const [c, meta] of Object.entries(S.meta.contenders)) {
    const h = S.health[c];
    const span = document.createElement("span");
    span.className = "pill";
    span.innerHTML = `<i class="dot ${h ? (h.ok ? "up" : "down") : ""}"></i>${esc(meta.label)} <span>${lastLat[c] != null ? ms(lastLat[c]) : h?.ok ? (h.cold ? "cold" : "ready") : "offline"}</span>`;
    span.title = typeof h?.detail === "string" ? h.detail : JSON.stringify(h?.detail ?? "");
    bar.append(span);
  }
}
async function pollHealth() {
  try { S.health = await api("/api/health"); } catch { S.health = {}; }
  renderStatus();
}

$("#rb-score").onclick = () => open("scoreboard");
$("#rb-warm").onclick = warmup;
$("#rb-reset").onclick = async (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; status("Click the bin again within 3s to clear every result and vote."); setTimeout(() => (btn.dataset.armed = ""), 3000); return; }
  btn.dataset.armed = "";
  await api("/api/results", { method: "DELETE" });
  S.results = {}; S.sel = null; status("all results cleared"); render();
};

(async function boot() {
  S.meta = await api("/api/meta");
  for (const c of [...S.enabled]) if (!S.meta.contenders[c]) S.enabled.delete(c);
  const deep = location.hash.slice(1) === "simulate" ? "battleground" : location.hash.slice(1);
  if (NOTES.some((n) => n.id === deep)) { if (!S.tabs.includes(deep)) S.tabs.push(deep); S.view = deep; }
  renderVault(); renderTabs(); render(); pollHealth();
  setInterval(pollHealth, 8000);
})();
