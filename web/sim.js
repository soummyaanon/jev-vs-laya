"use strict";
// Battleground: one click runs every game for every selected contender, live on one stage,
// then builds a report card. Loaded after app.js and uses its globals ($, api, S, enabled, label, ...).

const SIM_GAMES = ["triage", "language", "jailbreak", "bigmenu"];
const SIM = { running: false, stop: false, steps: [], cfg: { boards: 3, ticks: 150, speed: 30 }, report: null,
  boards: {}, live: {}, tape: {}, cur: null, speed: {}, t0: 0 };
const SEEDS = [42, 7, 1234, 99, 2026];
const CARD_COLOR = { jev: "#3987e5", laya: "#d95926", "laya-typed": "#199e70" };
const SHORT = { triage: "Triage", language: "Languages", jailbreak: "Safety", bigmenu: "Big menu", snake: "Snake", speed: "Speed", warmup: "Warm-up", report: "Report" };

function simSteps() {
  const g = S.meta.games;
  return [
    { id: "warmup", total: 1 },
    ...SIM_GAMES.map((id) => ({ id, total: g[id].rounds.length })),
    { id: "snake", total: SIM.cfg.boards },
    { id: "speed", total: SIM.cfg.speed },
    { id: "report", total: 1 },
  ].map((s) => ({ ...s, done: 0, state: "pending", ms: 0 }));
}

function jevCallEstimate() {
  if (!S.enabled.has("jev")) return null;
  const rounds = SIM_GAMES.reduce((a, g) => a + S.meta.games[g].rounds.length, 0);
  return { min: rounds + 6 + SIM.cfg.speed, max: rounds + 6 + SIM.cfg.speed + SIM.cfg.boards * SIM.cfg.ticks };
}

// ------------------------------------------------------------------ stage
function renderSim(n, doc) {
  const cs = enabled();
  if (!SIM.steps.length) SIM.steps = simSteps();
  const est = jevCallEstimate();
  doc.innerHTML = `
    <div class="stage-head">
      <div><div class="crumbs">jev-vs-laya / arena / <b>battleground.md</b></div>
        <h1><span class="hash">#</span>Battleground</h1></div>
      <div class="toolbar">
        <button class="btn primary" id="sim-go" ${SIM.running || cs.length < 2 ? "disabled" : ""}>▶ Start battle</button>
        <button class="btn" id="sim-stop" ${SIM.running ? "" : "disabled"}>Stop</button>
      </div>
    </div>
    <details class="settings" ${SIM.running ? "" : ""}><summary>${cs.map(label).join(" vs ") || "no contenders"} · ${SIM.cfg.boards} snake boards · ${SIM.cfg.ticks}-tick cap · ${SIM.cfg.speed} speed calls${est ? ` · ${est.min}–${est.max} Jev calls` : ""}</summary>
      <div class="toolbar">
        <label class="hint" for="sim-boards">snake boards</label>
        <input class="field" id="sim-boards" type="number" min="1" max="5" value="${SIM.cfg.boards}" style="width:64px" ${SIM.running ? "disabled" : ""}>
        <label class="hint" for="sim-ticks">tick cap</label>
        <input class="field" id="sim-ticks" type="number" min="30" max="400" step="10" value="${SIM.cfg.ticks}" style="width:76px" ${SIM.running ? "disabled" : ""}>
        <label class="hint" for="sim-speed">speed calls</label>
        <input class="field" id="sim-speed" type="number" min="10" max="200" step="10" value="${SIM.cfg.speed}" style="width:76px" ${SIM.running ? "disabled" : ""}>
      </div></details>
    ${cs.length < 2 ? `<div class="err">Select at least two contenders in the sidebar.</div>` : ""}
    <section class="stage" aria-live="polite">
      <div class="scoreline" id="st-score"></div>
      <ol class="rail" id="st-rail"></ol>
      <div class="live" id="st-live"></div>
    </section>
    <div id="sim-report" ${SIM.running ? "hidden" : ""}>${SIM.report ? reportBlock(SIM.report) : ""}</div>`;
  $("#sim-go").onclick = runSim;
  $("#sim-stop").onclick = () => { SIM.stop = true; status("stopping after the current call…"); };
  for (const [id, key, lo, hi] of [["sim-boards", "boards", 1, 5], ["sim-ticks", "ticks", 30, 400], ["sim-speed", "speed", 10, 200]]) {
    $("#" + id).onchange = (e) => { SIM.cfg[key] = Math.max(lo, Math.min(hi, +e.target.value || lo)); SIM.steps = simSteps(); renderSim(n, doc); };
  }
  paintScore(); paintRail(); paintLive(true);
  bindReport();
}

const onSim = () => S.view === "battleground" && $("#st-live");

// Running totals across every scored answer so far.
function totals(c) {
  let ok = 0, n = 0;
  for (const g of SIM_GAMES) { const v = SIM.live[g]?.[c]; if (v) { ok += v.ok; n += v.n; } }
  const lat = SIM_GAMES.flatMap((g) => SIM.live[g]?.[c]?.lat || []);
  return { ok, n, acc: n ? ok / n : null, lat: lat.length ? quant(lat, 0.5) : null };
}

function paintScore() {
  if (!onSim()) return;
  const cs = enabled();
  const rep = !SIM.running && !SIM.cur && SIM.report;
  $("#st-score").innerHTML = cs.map((c, i) => {
    const t = totals(c);
    const acc = rep ? rep.overall[c]?.accuracy : t.acc;
    const lat = rep ? rep.speed[c]?.p50 : t.lat;
    return `${i ? `<span class="vs">vs</span>` : ""}<div class="side">
      <div class="name" style="color:${COLOR[c]}">${esc(label(c))}</div>
      <div class="big">${acc == null ? "—" : (acc * 100).toFixed(1)}<small>%</small></div>
      <div class="meta">${rep ? "accuracy · last run" : t.n ? `${t.ok}/${t.n} correct` : "accuracy"} · ${lat == null ? "–" : ms(lat)} p50</div></div>`;
  }).join("");
}

function paintRail() {
  if (!onSim()) return;
  $("#st-rail").innerHTML = SIM.steps.map((s) => {
    const sc = SIM_GAMES.includes(s.id) && SIM.live[s.id]
      ? enabled().map((c) => { const v = SIM.live[s.id][c]; return v?.n ? `<span style="color:${COLOR[c]}">${Math.round((v.ok / v.n) * 100)}</span>` : ""; }).filter(Boolean).join(" · ")
      : s.id === "snake" && SIM.snakeFood ? enabled().map((c) => `<span style="color:${COLOR[c]}">${SIM.snakeFood[c] ?? 0}</span>`).join(" · ")
      : s.id === "speed" && SIM.speed[enabled()[0]]?.length ? enabled().map((c) => `<span style="color:${COLOR[c]}">${ms(quant(SIM.speed[c], 0.5))}</span>`).join(" · ")
      : "";
    const pct = s.total ? (s.done / s.total) * 100 : 0;
    return `<li class="step ${s.state}"><span class="step-name">${esc(SHORT[s.id])}</span>
      <span class="step-bar"><i style="width:${pct}%"></i></span>
      <span class="step-score">${sc || (s.state === "pending" ? "" : `${s.done}/${s.total}`)}</span></li>`;
  }).join("");
}

// The live area shows whatever is happening right now.
function paintLive(full = false) {
  if (!onSim()) return;
  const el = $("#st-live"), cur = SIM.cur;
  if (!cur) {
    el.innerHTML = SIM.report ? `<p class="hint center">Last run finished. The report card is below. Press Start battle to fight again.</p>`
      : `<p class="hint center">Press <b>Start battle</b>. Every round of every game plays here live, then a report card is built.</p>`;
    return;
  }
  if (cur.kind === "round") return paintRound(el, cur);
  if (cur.kind === "snake") return paintSnakeStage(el, cur, full);
  if (cur.kind === "speed") return paintSpeedStage(el, cur, full);
  el.innerHTML = `<p class="hint center cursor">${esc(cur.text || "")} </p>`;
}

function answerChip(q, a, g) {
  if (!a) return `<span class="chip dim">…</span>`;
  const v = a.type === "choice" ? a.choice : a.type === "score" ? Math.round(a.score) + (q.criteria?.[Math.round(a.score)] ? "" : "") : a.type === "noul" ? (a.noul >= 0.5 ? "yes" : "no") : "?";
  const p = a.type === "choice" ? a.probabilities?.[a.choice] : a.type === "noul" ? (a.noul >= 0.5 ? a.noul : 1 - a.noul) : a.probabilities?.[String(Math.round(a.score))];
  const cls = g ? (g.correct ? "ok" : "no") : "";
  return `<span class="chip ${cls}" title="p ${fmt(p)}">${g ? (g.correct ? "✓" : "✗") : ""} ${esc(String(v))}<small>${p == null ? "" : fmt(p)}</small></span>`;
}
function goldText(q, v) { return q.type === "noul" ? (v ? "yes" : "no") : String(v); }

function paintRound(el, cur) {
  const r = S.meta.games[cur.game].rounds[cur.i], cs = enabled(), qs = r.questions;
  const text = typeof r.state === "string" ? r.state : JSON.stringify(r.state);
  el.innerHTML = `
    <div class="round-head"><span class="eyebrow">${esc(S.meta.games[cur.game].title)}</span><span class="hint">round ${cur.i + 1} / ${S.meta.games[cur.game].rounds.length}${r.tag ? ` · ${esc(r.tag)}` : ""}</span></div>
    <blockquote class="ticket" ${/[؀-ۿ]/.test(text) ? 'dir="rtl"' : ""}>${esc(text)}</blockquote>
    <div class="answers scroll-x"><table class="ans">
      <thead><tr><th></th>${Object.keys(qs).map((q) => `<th>${esc(q.replace(/_/g, " "))}</th>`).join("")}<th>time</th></tr></thead>
      <tbody>
        <tr class="gold-row"><td>answer key</td>${Object.entries(qs).map(([q, d]) => `<td>${esc(goldText(d, r.gold[q]))}</td>`).join("")}<td></td></tr>
        ${cs.map((c) => { const res = cur.res?.[c]; return `<tr><td><span class="who ${c}">${esc(label(c))}</span></td>
          ${res?.error ? `<td colspan="${Object.keys(qs).length}" class="err">${esc(res.error.slice(0, 90))}</td>` :
            Object.entries(qs).map(([q, d]) => `<td>${answerChip(d, res?.answers?.[q], res?.grade?.[q])}</td>`).join("")}
          <td class="t">${res ? ms(res.latency_ms) : `<span class="cursor"></span>`}</td></tr>`; }).join("")}
      </tbody></table></div>
    <div class="tapes">${cs.map((c) => `<div class="tape"><span class="who ${c}">${esc(label(c))}</span><span class="cells">${(SIM.tape[cur.game] || []).map((t) => `<i style="--c:${COLOR[c]};opacity:${t[c] == null ? 0.12 : 0.15 + 0.85 * t[c]}" title="${t[c] == null ? "" : Math.round(t[c] * 100) + "%"}"></i>`).join("")}</span></div>`).join("")}</div>`;
}

function paintSnakeStage(el, cur, full) {
  const cs = enabled();
  if (full || !el.querySelector(".boards")) {
    el.innerHTML = `<div class="round-head"><span class="eyebrow">Snake</span><span class="hint" id="sn-head"></span></div>
      <div class="boards" style="--n:${cs.length}">${cs.map((c) => `<figure class="board">
        <canvas id="sim-cv-${c}" width="480" height="480" aria-label="${esc(label(c))} snake board"></canvas>
        <figcaption><span class="who ${c}">${esc(label(c))}</span><span id="sim-stat-${c}" class="hint"></span></figcaption>
        <div class="hint mono" id="sim-why-${c}"></div></figure>`).join("")}</div>`;
  }
  $("#sn-head").textContent = `board ${cur.board + 1} / ${SIM.cfg.boards} · seed ${cur.seed} · tick ${Math.max(0, ...cs.map((c) => SIM.boards[c]?.ticks || 0))} / ${SIM.cfg.ticks}`;
  cs.forEach((c) => SIM.boards[c] && drawSnake(c, SIM.boards[c], "sim"));
}

function paintSpeedStage(el, cur, full) {
  const cs = enabled();
  if (full || !el.querySelector("#sim-speed-chart")) {
    el.innerHTML = `<div class="round-head"><span class="eyebrow">Speed race</span><span class="hint" id="sp-head"></span></div>
      <svg class="chart" id="sim-speed-chart" viewBox="0 0 720 240" role="img" aria-label="latency per call"></svg>`;
  }
  $("#sp-head").textContent = `call ${cur.i + 1} / ${SIM.cfg.speed} · ` + cs.map((c) => `${label(c)} p50 ${ms(quant(SIM.speed[c], 0.5))}`).join(" · ");
  lineChart($("#sim-speed-chart"), cs.filter((c) => SIM.speed[c]?.length).map((c) => ({ c, xs: SIM.speed[c] })));
}

// ------------------------------------------------------------------ run
async function runSim() {
  const cs = enabled();
  Object.assign(SIM, { running: true, stop: false, steps: simSteps(), boards: {}, live: {}, tape: {}, cur: null, speed: {}, snakeFood: null, t0: performance.now() });
  render();
  const { run } = await api("/api/runs", { method: "POST", body: { contenders: cs } });
  const snakeOut = {};
  const step = async (id, fn) => {
    const s = SIM.steps.find((x) => x.id === id);
    if (SIM.stop) { s.state = "stopped"; paintRail(); return; }
    s.state = "running"; paintRail();
    const st = performance.now();
    try { await fn(s); s.state = SIM.stop ? "stopped" : "done"; }
    catch (e) { s.state = "failed"; status(`${SHORT[id]} failed: ${e.message.slice(0, 80)}`); }
    s.ms = performance.now() - st; paintRail();
  };

  await step("warmup", async (s) => {
    SIM.cur = { kind: "text", text: "warming up every model" }; paintLive(true);
    await api("/api/warmup", { method: "POST", body: { contenders: cs } }); s.done = 1;
  });

  for (const g of SIM_GAMES) {
    await step(g, async (s) => {
      SIM.live[g] = Object.fromEntries(cs.map((c) => [c, { ok: 0, n: 0, lat: [] }]));
      SIM.tape[g] = [];
      for (let i = 0; i < s.total && !SIM.stop; i++) {
        SIM.cur = { kind: "round", game: g, i, res: null }; paintLive();
        const out = await api(`/api/games/${g}/${i}`, { method: "POST", body: { contenders: cs, run } });
        const res = Object.fromEntries(out.results.map((r) => [r.contender, r]));
        SIM.cur.res = res;
        const tape = {};
        for (const c of cs) {
          const r = res[c], L = SIM.live[g][c];
          const gs = Object.values(r?.grade || {});
          L.ok += gs.filter((x) => x.correct).length; L.n += Object.keys(S.meta.games[g].rounds[i].gold).length;
          L.lat.push(r.latency_ms);
          tape[c] = gs.length ? gs.filter((x) => x.correct).length / gs.length : 0;
          noteLatency(r);
        }
        SIM.tape[g].push(tape);
        S.results[g] ||= {}; S.results[g][i] = { ...(S.results[g][i] || {}), ...res };
        s.done = i + 1;
        paintLive(); paintScore(); paintRail();
        status(`${S.meta.games[g].title}: round ${i + 1}/${s.total}`);
        await new Promise((r) => setTimeout(r, 250)); // let viewers read the round
      }
    });
  }

  await step("snake", async (s) => {
    SIM.snakeFood = Object.fromEntries(cs.map((c) => [c, 0]));
    for (const c of cs) snakeOut[c] = [];
    for (let b = 0; b < s.total && !SIM.stop; b++) {
      const seed = SEEDS[b % SEEDS.length];
      for (const c of cs) SIM.boards[c] = newSnake(seed);
      SIM.cur = { kind: "snake", board: b, seed }; paintLive(true);
      while (!SIM.stop && cs.some((c) => SIM.boards[c].alive && SIM.boards[c].ticks < SIM.cfg.ticks)) {
        await Promise.all(cs.map((c) => (SIM.boards[c].alive && SIM.boards[c].ticks < SIM.cfg.ticks ? snakeTick(SIM.boards[c], c, run, b) : null)));
        paintLive();
      }
      for (const c of cs) {
        const x = SIM.boards[c];
        SIM.snakeFood[c] += x.eaten;
        snakeOut[c].push({ seed, food: x.eaten, ticks: x.ticks, survived: x.alive, death: x.death,
          avg_ms: x.lat.length ? x.lat.reduce((a, v) => a + v, 0) / x.lat.length : null });
      }
      s.done = b + 1; paintRail();
      await new Promise((r) => setTimeout(r, 900));
    }
  });

  await step("speed", async (s) => {
    for (const c of cs) SIM.speed[c] = [];
    SIM.cur = { kind: "speed", i: 0 }; paintLive(true);
    for (let i = 0; i < s.total && !SIM.stop; i++) {
      for (const c of cs) {
        const r = await api("/api/speed", { method: "POST", body: { contender: c, i, run } });
        if (!r.error) SIM.speed[c].push(r.latency_ms);
        noteLatency({ contender: c, latency_ms: r.latency_ms });
      }
      SIM.cur.i = i; s.done = i + 1; paintLive(); paintRail();
    }
  });

  await step("report", async (s) => {
    SIM.cur = { kind: "text", text: "building the report card" }; paintLive(true);
    SIM.report = await buildReport(run, cs, snakeOut, SIM.speed, performance.now() - SIM.t0);
    await api(`/api/runs/${run}`, { method: "PUT", body: { report: SIM.report } });
    s.done = 1;
  });

  SIM.running = false; SIM.cur = null;
  status(SIM.stop ? "battle stopped" : `battle finished in ${((performance.now() - SIM.t0) / 1000).toFixed(0)}s`);
  if (S.view === "battleground") { render(); $("#sim-report")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

function quant(xs, p) { if (!xs?.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; }
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

async function buildReport(run, cs, snakeOut, speedOut, elapsed) {
  const per = await Promise.all(SIM_GAMES.map((g) => api(`/api/scoreboard?game=${g}&run=${run}`)));
  const all = await api(`/api/scoreboard?run=${run}`);
  const games = Object.fromEntries(SIM_GAMES.map((g, i) => [g, {
    title: S.meta.games[g].title, rounds: S.meta.games[g].rounds.length,
    stats: Object.fromEntries(cs.map((c) => { const v = per[i].contenders[c] || {}; return [c, { accuracy: v.accuracy, p_true: v.p_true, brier: v.brier, p50: v.p50 }]; })),
    by_tag: g === "language" ? Object.fromEntries(cs.map((c) => [c, per[i].contenders[c]?.by_tag || {}])) : null,
  }]));
  // Overall accuracy = graded answers across the four scored games.
  const overall = {};
  for (const c of cs) {
    let ok = 0, n = 0, pt = [], br = [];
    SIM_GAMES.forEach((g, i) => {
      const v = per[i].contenders[c];
      if (!v?.graded) return;
      ok += v.accuracy * v.graded; n += v.graded;
      if (v.p_true != null) pt.push([v.p_true, v.graded]);
      if (v.brier != null) br.push(v.brier);
    });
    const wmean = (xs) => { const w = xs.reduce((a, [, k]) => a + k, 0); return w ? xs.reduce((a, [v, k]) => a + v * k, 0) / w : null; };
    overall[c] = { accuracy: n ? ok / n : null, graded: n, p_true: wmean(pt), brier: mean(br),
      errors: all.contenders[c]?.error_rate ?? 0, calls: all.contenders[c]?.calls ?? 0, tokens: all.contenders[c]?.tokens ?? 0 };
  }
  const snake = Object.fromEntries(cs.map((c) => {
    const b = snakeOut[c] || [];
    return [c, { boards: b, food: mean(b.map((x) => x.food)), ticks: mean(b.map((x) => x.ticks)),
      alive: b.filter((x) => x.survived).length, avg_ms: mean(b.map((x) => x.avg_ms).filter((x) => x != null)) }];
  }));
  const speed = Object.fromEntries(cs.map((c) => [c, { n: speedOut[c]?.length || 0, p50: quant(speedOut[c], 0.5), p95: quant(speedOut[c], 0.95) }]));
  return {
    run, date: new Date().toISOString(), elapsed_s: Math.round(elapsed / 1000), contenders: cs,
    labels: Object.fromEntries(cs.map((c) => [c, label(c)])), routed: all.routed || {},
    cfg: { ...SIM.cfg }, games, overall, snake, speed,
  };
}

// ------------------------------------------------------------------ report card
function winner(rep, get, dir = "max") {
  const vals = rep.contenders.map((c) => [c, get(c)]).filter(([, v]) => v != null);
  if (vals.length < 2) return null;
  vals.sort((a, b) => (dir === "max" ? b[1] - a[1] : a[1] - b[1]));
  return Math.abs(vals[0][1] - vals[1][1]) < 1e-9 ? "tie" : vals[0][0];
}

function reportBlock(rep) {
  return `<div class="toolbar" style="margin-bottom:12px">
      <h2 style="margin-right:auto"><span class="hash">##</span>Report card</h2>
      <button class="btn primary" id="rc-png">Download PNG</button>
      <button class="btn" id="rc-svg">Download SVG</button>
      <button class="btn" id="rc-json">Download JSON</button>
    </div>
    <div class="scroll-x" style="border-radius:10px">${reportSVG(rep)}</div>`;
}

function bindReport() {
  const rep = SIM.report;
  if (!rep || !$("#rc-png")) return;
  const name = `jev-vs-laya-${rep.run}`;
  $("#rc-svg").onclick = () => save(new Blob([reportSVG(rep)], { type: "image/svg+xml" }), name + ".svg");
  $("#rc-json").onclick = () => save(new Blob([JSON.stringify(rep, null, 2)], { type: "application/json" }), name + ".json");
  $("#rc-png").onclick = async () => {
    const svg = reportSVG(rep), vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/), w = +vb[1], h = +vb[2];
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const cv = document.createElement("canvas"); cv.width = w * 2; cv.height = h * 2;
    const x = cv.getContext("2d"); x.scale(2, 2); x.drawImage(img, 0, 0);
    cv.toBlob((b) => save(b, name + ".png"), "image/png");
  };
}
function save(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function reportSVG(rep) {
  const cs = rep.contenders, L = rep.labels, col = (c) => CARD_COLOR[c] || "#a88bfa";
  const F = `font-family="JetBrains Mono, Menlo, ui-monospace, monospace"`;
  const S2 = `font-family="IBM Plex Sans, -apple-system, Helvetica, Arial, sans-serif"`;
  const W = 1200, P = 56;
  const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" ${o.sans ? S2 : F} font-size="${o.size || 16}" fill="${o.fill || "#dcdcdf"}" ${o.anchor ? `text-anchor="${o.anchor}"` : ""} ${o.weight ? `font-weight="${o.weight}"` : ""} ${o.ls ? `letter-spacing="${o.ls}"` : ""}>${esc(s)}</text>`;
  const pctS = (v) => (v == null ? "–" : (v * 100).toFixed(1) + "%");
  const msS = (v) => (v == null ? "–" : v < 100 ? v.toFixed(0) + "ms" : Math.round(v) + "ms");
  let y = 0, g = "";

  // header
  y = P + 8;
  g += t(P, y, "BATTLEGROUND REPORT", { size: 14, fill: "#a88bfa", ls: 2 });
  g += t(W - P, y, new Date(rep.date).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }), { size: 14, fill: "#6f6f78", anchor: "end" });
  y += 62;
  let x = P;
  cs.forEach((c, i) => {
    if (i) { g += t(x, y, "vs", { size: 30, fill: "#6f6f78", sans: true }); x += 52; }
    g += t(x, y, L[c], { size: 52, fill: col(c), weight: 600, sans: true });
    x += L[c].length * 29 + 22;
  });
  y += 34;
  g += t(P, y, `Same inputs, byte-identical · ${rep.games.triage.rounds + rep.games.language.rounds + rep.games.jailbreak.rounds + rep.games.bigmenu.rounds} scored rounds · ${rep.cfg.boards} snake boards · ${rep.speed[cs[0]].n} speed calls each`, { size: 15, fill: "#a3a3ab", sans: true });

  // verdict tiles
  y += 36;
  const acc = winner(rep, (c) => rep.overall[c].accuracy);
  const spd = winner(rep, (c) => rep.speed[c].p50, "min");
  const snk = winner(rep, (c) => (rep.snake[c].food ?? 0) * 1000 + (rep.snake[c].ticks ?? 0));
  const cal = winner(rep, (c) => rep.overall[c].p_true);
  const tiles = [
    ["ACCURACY", acc, (c) => pctS(rep.overall[c].accuracy)],
    ["CALIBRATION · p(true)", cal, (c) => (rep.overall[c].p_true ?? 0).toFixed(2)],
    ["SPEED · p50", spd, (c) => msS(rep.speed[c].p50)],
    ["SNAKE · avg food", snk, (c) => (rep.snake[c].food ?? 0).toFixed(1)],
  ];
  const tw = (W - 2 * P - 3 * 16) / 4, th = 150;
  tiles.forEach(([name, win, val], i) => {
    const tx = P + i * (tw + 16);
    g += `<rect x="${tx}" y="${y}" width="${tw}" height="${th}" rx="10" fill="#1c1c1f" stroke="${win && win !== "tie" ? col(win) : "#2e2e33"}" stroke-width="${win && win !== "tie" ? 1.5 : 1}"/>`;
    g += t(tx + 18, y + 30, name, { size: 12, fill: "#6f6f78", ls: 1.2 });
    g += t(tx + 18, y + 68, win === "tie" ? "Tie" : win ? L[win] : "–", { size: 28, weight: 600, sans: true, fill: win && win !== "tie" ? col(win) : "#dcdcdf" });
    cs.forEach((c, k) => { g += t(tx + 18, y + 100 + k * 20, `${L[c]}`, { size: 13, fill: "#a3a3ab" }) + t(tx + tw - 18, y + 100 + k * 20, val(c), { size: 13, anchor: "end", fill: c === win ? "#dcdcdf" : "#a3a3ab", weight: c === win ? 600 : null }); });
  });
  y += th;
  if (spd && spd !== "tie") {
    const other = cs.filter((c) => c !== spd).map((c) => rep.speed[c].p50).filter(Boolean);
    if (other.length) { y += 30; g += t(P, y, `${L[spd]} answered ${(Math.min(...other) / rep.speed[spd].p50).toFixed(1)}× faster at p50.`, { size: 15, fill: "#a3a3ab", sans: true }); }
  }

  // per-game accuracy bars
  y += 46;
  g += t(P, y, "ACCURACY BY GAME", { size: 13, fill: "#a88bfa", ls: 1.5 });
  y += 14;
  const labelW = 230, valW = 80, barW = W - 2 * P - labelW - valW, rowH = 18, gap = 6;
  for (const gid of SIM_GAMES) {
    const G = rep.games[gid];
    const bw = winner(rep, (c) => G.stats[c].accuracy);
    y += 24;
    g += `<line x1="${P}" x2="${W - P}" y1="${y - 10}" y2="${y - 10}" stroke="#2e2e33"/>`;
    g += t(P, y + 14, G.title, { size: 17, weight: 600, sans: true });
    g += t(P, y + 34, `${G.rounds} rounds${gid === "bigmenu" ? " · 50 options" : ""}`, { size: 12, fill: "#6f6f78" });
    cs.forEach((c, k) => {
      const v = G.stats[c].accuracy ?? 0, by = y + k * (rowH + gap);
      g += `<rect x="${P + labelW}" y="${by}" width="${barW}" height="${rowH}" rx="3" fill="#232327"/>`;
      g += `<rect x="${P + labelW}" y="${by}" width="${Math.max(2, v * barW)}" height="${rowH}" rx="3" fill="${col(c)}"/>`;
      g += t(W - P, by + 14, pctS(G.stats[c].accuracy) + (c === bw ? " ◂" : ""), { size: 14, anchor: "end", fill: c === bw ? "#dcdcdf" : "#a3a3ab", weight: c === bw ? 600 : null });
    });
    y += Math.max(44, cs.length * (rowH + gap));
  }

  // language breakdown
  const langs = Object.keys(rep.games.language.by_tag?.[cs[0]] || {});
  if (langs.length) {
    y += 40;
    g += t(P, y, "LANGUAGE GAUNTLET · accuracy per language", { size: 13, fill: "#a88bfa", ls: 1.5 });
    y += 30;
    const cw = (W - 2 * P - 150) / langs.length;
    langs.forEach((l, i) => { g += t(P + 150 + i * cw + cw / 2, y, l, { size: 12, fill: "#6f6f78", anchor: "middle" }); });
    cs.forEach((c, k) => {
      const ry = y + 14 + k * 34;
      g += t(P, ry + 21, L[c], { size: 15, fill: col(c), weight: 600 });
      langs.forEach((l, i) => {
        const v = rep.games.language.by_tag[c][l] ?? 0, cx = P + 150 + i * cw;
        g += `<rect x="${cx + 4}" y="${ry}" width="${cw - 8}" height="28" rx="4" fill="${col(c)}" fill-opacity="${0.12 + 0.75 * v}"/>`;
        g += t(cx + cw / 2, ry + 19, Math.round(v * 100) + "%", { size: 13, anchor: "middle", fill: v > 0.55 ? "#ffffff" : "#dcdcdf" });
      });
    });
    y += 14 + cs.length * 34;
  }

  // snake + speed side by side
  y += 44;
  const half = (W - 2 * P - 24) / 2;
  g += t(P, y, "SNAKE DUEL", { size: 13, fill: "#a88bfa", ls: 1.5 });
  g += t(P + half + 24, y, "SPEED RACE · single-question latency", { size: 13, fill: "#a88bfa", ls: 1.5 });
  y += 14;
  const boxH = 48 + cs.length * 44;
  g += `<rect x="${P}" y="${y}" width="${half}" height="${boxH}" rx="10" fill="#1c1c1f" stroke="#2e2e33"/>`;
  g += `<rect x="${P + half + 24}" y="${y}" width="${half}" height="${boxH}" rx="10" fill="#1c1c1f" stroke="#2e2e33"/>`;
  const sc = [["avg food", 190], ["avg ticks", 290], ["survived", 400], ["per move", half - 20]];
  sc.forEach(([h, ox]) => { g += t(P + ox, y + 30, h, { size: 12, fill: "#6f6f78", anchor: "end" }); });
  cs.forEach((c, k) => {
    const s = rep.snake[c], ry = y + 64 + k * 44;
    g += t(P + 20, ry, L[c], { size: 15, fill: col(c), weight: 600 });
    g += t(P + 190, ry, (s.food ?? 0).toFixed(1), { size: 15, anchor: "end", weight: c === snk ? 600 : null });
    g += t(P + 290, ry, (s.ticks ?? 0).toFixed(0), { size: 15, anchor: "end" });
    g += t(P + 400, ry, `${s.alive}/${s.boards.length}`, { size: 15, anchor: "end" });
    g += t(P + half - 20, ry, msS(s.avg_ms), { size: 15, anchor: "end", fill: "#a3a3ab" });
    const deaths = s.boards.filter((b) => !b.survived).map((b) => ({ wall: "hit the wall", body: "hit itself", error: "error" })[b.death] || "?");
    g += t(P + 20, ry + 18, deaths.length ? "died: " + deaths.join(", ") : `alive at the ${rep.cfg.ticks}-tick cap`, { size: 11, fill: "#6f6f78" });
  });
  const sx = P + half + 24, maxP = Math.max(...cs.map((c) => rep.speed[c].p95 || 0)) || 1, sbw = half - 200;
  g += t(sx + half - 20, y + 30, "p50 / p95", { size: 12, fill: "#6f6f78", anchor: "end" });
  cs.forEach((c, k) => {
    const s = rep.speed[c], ry = y + 50 + k * 44;
    g += t(sx + 20, ry + 14, L[c], { size: 15, fill: col(c), weight: 600 });
    g += `<rect x="${sx + 20}" y="${ry + 22}" width="${sbw}" height="8" rx="2" fill="#232327"/>`;
    g += `<rect x="${sx + 20}" y="${ry + 22}" width="${Math.max(3, ((s.p95 || 0) / maxP) * sbw)}" height="8" rx="2" fill="${col(c)}" fill-opacity=".35"/>`;
    g += `<rect x="${sx + 20}" y="${ry + 22}" width="${Math.max(3, ((s.p50 || 0) / maxP) * sbw)}" height="8" rx="2" fill="${col(c)}"/>`;
    g += t(sx + half - 20, ry + 30, `${msS(s.p50)} / ${msS(s.p95)}`, { size: 15, anchor: "end", weight: c === spd ? 600 : null });
  });
  y += boxH;

  // footer
  y += 44;
  g += `<line x1="${P}" x2="${W - P}" y1="${y - 20}" y2="${y - 20}" stroke="#2e2e33"/>`;
  const routed = cs.map((c) => `${L[c]}: ${(rep.routed[c] || []).join(", ") || "–"}`).join("   ·   ");
  const foot = [
    `Models used — ${routed}`,
    "Laya runs on an Apple M4 Pro GPU (MPS), auto-routed per request; Snake uses its typed-decisions checkpoint.",
    "Jev is jev-latest over api.typesafe.ai (HTTP/2, warm connection). Latency includes the network for both.",
    "Ranked by accuracy and the probability each model gave the true answer, not self-reported confidence.",
  ];
  foot.forEach((line, i) => { g += t(P, y + i * 22, line, { size: 12.5, fill: "#6f6f78" }); });
  y += foot.length * 22 + 10;
  g += t(P, y + 14, `run ${rep.run} · ${rep.elapsed_s}s · ${rep.overall[cs[0]].graded} graded answers per model`, { size: 12, fill: "#4a4a52" });
  y += 14 + P;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${y}" width="${W}" style="max-width:100%;height:auto;display:block">
    <rect width="${W}" height="${y}" rx="18" fill="#161618"/>
    <rect x="0.5" y="0.5" width="${W - 1}" height="${y - 1}" rx="18" fill="none" stroke="#2e2e33"/>${g}</svg>`;
}

// Restore the last report so the page opens complete.
api("/api/runs/latest").then((r) => { if (r.report) { SIM.report = r.report; if (S.meta && S.view === "battleground") render(); } }).catch(() => {});

$("#rb-sim").onclick = () => open("battleground");
