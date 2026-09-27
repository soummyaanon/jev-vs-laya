"""Jev vs Laya arena backend.

Serves the UI from ./web and proxies every model call so API keys stay server-side.
Run:  .venv-laya/bin/uvicorn arena:app --port 9000
"""
import asyncio
import json
import math
import os
import random
import sqlite3
import statistics
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from games import GAMES, noul

ROOT = Path(__file__).parent


def load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env()

LAYA_URL = os.environ.get("LAYA_URL", "http://localhost:8000/v1/systemone")
LAYA_HEADERS = ({"Authorization": f"Bearer {os.environ['LAYA_API_KEY']}"}
                if os.environ.get("LAYA_API_KEY") else {})

CONTENDERS = {
    "jev": {"label": "Jev", "url": "https://api.typesafe.ai/v1/systemone",
            "headers": {"Authorization": f"Bearer {os.environ.get('TYPESAFE_API_KEY', '')}"},
            "model": "jev-latest", "host": "cloud"},
    "laya": {"label": "Laya", "url": LAYA_URL, "headers": LAYA_HEADERS,
             "model": None, "host": "local · auto"},
    "laya-typed": {"label": "Laya typed", "url": LAYA_URL, "headers": LAYA_HEADERS,
                   "model": "typed-decisions", "host": "local · typed"},
}

DB = ROOT / "arena.db"


def db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con


with db() as con:
    con.executescript("""
    CREATE TABLE IF NOT EXISTS calls(
        id INTEGER PRIMARY KEY, ts REAL, game TEXT, round INTEGER, tag TEXT,
        contender TEXT, latency_ms REAL, error TEXT, answers TEXT, grade TEXT,
        usage TEXT, routed TEXT);
    CREATE TABLE IF NOT EXISTS runs(
        id TEXT PRIMARY KEY, ts REAL, contenders TEXT, report TEXT);
    CREATE TABLE IF NOT EXISTS votes(
        id INTEGER PRIMARY KEY, ts REAL, a TEXT, b TEXT, winner TEXT);
    """)

    if "run" not in [r[1] for r in con.execute("PRAGMA table_info(calls)")]:
        con.execute("ALTER TABLE calls ADD COLUMN run TEXT")

app = FastAPI(title="Jev vs Laya arena")


@app.middleware("http")
async def no_cache_ui(request, call_next):
    # The UI changes often while we iterate; never let the browser serve a stale copy.
    resp = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp
client: httpx.AsyncClient | None = None


@app.on_event("startup")
async def _startup():
    global client
    # Long keep-alive + HTTP/2: Jev's TLS handshake costs 100-650ms, so never pay it twice.
    client = httpx.AsyncClient(timeout=60, http2=True,
                               limits=httpx.Limits(max_keepalive_connections=20, keepalive_expiry=120))
    asyncio.create_task(_warm_all())


async def _warm_all():
    """Open Jev's connection and run every Laya checkpoint once so no scored call is cold."""
    try:
        await warmup(RoundIn(contenders=list(CONTENDERS)))
    except Exception:
        pass
    asyncio.create_task(_keep_jev_warm())


async def _keep_jev_warm():
    # A cheap HEAD every 60s keeps the pooled TLS connection to Jev alive between games.
    while True:
        await asyncio.sleep(60)
        try:
            await client.head("https://api.typesafe.ai/")
        except Exception:
            pass


@app.on_event("shutdown")
async def _shutdown():
    await client.aclose()


# Laya checkpoint per game, chosen from a local sweep of all three checkpoints.
# Auto-routing wins or ties everywhere except Snake, a typed decision task where the
# typed-decisions checkpoint never picked a deadly move (auto-route: 18%).
LAYA_GAME_MODEL = {"snake": "typed-decisions"}


async def ask(name, state, questions, game=None):
    cfg = CONTENDERS[name]
    body = {"state": state, "questions": questions}
    model = cfg["model"] or (LAYA_GAME_MODEL.get(game) if name == "laya" else None)
    if model:
        body["model"] = model
    t0 = time.perf_counter()
    try:
        r = await client.post(cfg["url"], headers=cfg["headers"], json=body)
        ms = (time.perf_counter() - t0) * 1000
        if r.status_code >= 400:
            return {"contender": name, "error": f"HTTP {r.status_code}: {r.text[:300]}", "latency_ms": ms}
        data = r.json()
        routed = data.get("model")
        if isinstance(data.get("routing"), dict):
            routed = data["routing"].get("model") or routed
        return {"contender": name, "answers": data.get("answers", {}), "usage": data.get("usage"),
                "routed": routed, "latency_ms": ms}
    except Exception as e:  # network error, timeout, bad JSON
        return {"contender": name, "error": f"{type(e).__name__}: {e}"[:300],
                "latency_ms": (time.perf_counter() - t0) * 1000}


def grade(answers, gold):
    """Per-question correctness plus the probability given to the true answer."""
    out = {}
    for qid, truth in (gold or {}).items():
        a = answers.get(qid) or {}
        t = a.get("type")
        probs = a.get("probabilities") or {}
        if t == "choice":
            out[qid] = {"correct": a.get("choice") == truth, "p_true": probs.get(truth, 0.0)}
        elif t == "score":
            s = a.get("score")
            if s is None:
                out[qid] = {"correct": False, "abs_err": None, "p_true": 0.0}
            else:
                out[qid] = {"correct": round(s) == truth, "abs_err": abs(s - truth),
                            "p_true": probs.get(str(truth), 0.0)}
        elif t == "noul":
            p = a.get("noul", 0.5)
            y = float(bool(truth))
            out[qid] = {"correct": (p >= 0.5) == bool(truth), "p_true": p if truth else 1 - p,
                        "brier": (p - y) ** 2}
        else:
            out[qid] = {"correct": False, "p_true": 0.0, "missing": True}
    return out


def record(game, rnd, tag, res, run=None):
    with db() as con:
        con.execute(
            "INSERT INTO calls(ts,game,round,tag,contender,latency_ms,error,answers,grade,usage,routed,run)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (time.time(), game, rnd, tag, res["contender"], res["latency_ms"], res.get("error"),
             json.dumps(res.get("answers")), json.dumps(res.get("grade")),
             json.dumps(res.get("usage")), res.get("routed"), run))


def pick(contenders):
    names = [c for c in (contenders or ["jev", "laya"]) if c in CONTENDERS]
    if not names:
        raise HTTPException(400, "Pick at least one contender.")
    return names


# ------------------------------------------------------------------------- API
@app.get("/api/meta")
async def meta():
    games = {k: {"title": g["title"], "rounds": g["rounds"]()} for k, g in GAMES.items()}
    return {"contenders": {k: {"label": v["label"], "host": v["host"]} for k, v in CONTENDERS.items()},
            "games": games}


@app.get("/api/health")
async def health():
    out = {}
    try:
        r = await client.get(LAYA_URL.replace("/v1/systemone", "/health"), timeout=3)
        out["laya"] = {"ok": r.status_code == 200, "detail": r.json()}
    except Exception as e:
        out["laya"] = {"ok": False, "detail": f"not reachable ({type(e).__name__})"}
    out["jev"] = {"ok": bool(os.environ.get("TYPESAFE_API_KEY")),
                  "detail": "key loaded" if os.environ.get("TYPESAFE_API_KEY") else "TYPESAFE_API_KEY missing"}
    loaded = out["laya"]["detail"].get("loaded", []) if out["laya"]["ok"] else []
    out["laya-typed"] = {**out["laya"], "cold": "typed-decisions" not in loaded}
    return out


class DuelIn(BaseModel):
    state: dict | str
    questions: dict
    gold: dict | None = None
    contenders: list[str] | None = None
    game: str = "custom"
    round: int = -1
    tag: str | None = None
    save: bool = True
    run: str | None = None


@app.post("/api/duel")
async def duel(d: DuelIn):
    names = pick(d.contenders)
    results = await asyncio.gather(*(ask(n, d.state, d.questions, d.game) for n in names))
    for r in results:
        if "answers" in r and d.gold:
            r["grade"] = grade(r["answers"], d.gold)
        if d.save:
            record(d.game, d.round, d.tag, r, d.run)
    return {"results": results}


class RoundIn(BaseModel):
    contenders: list[str] | None = None
    run: str | None = None


@app.post("/api/games/{game}/{idx}")
async def play_round(game: str, idx: int, body: RoundIn):
    if game not in GAMES:
        raise HTTPException(404, f"Unknown game {game!r}.")
    rounds = GAMES[game]["rounds"]()
    if not 0 <= idx < len(rounds):
        raise HTTPException(404, f"{game} has rounds 0-{len(rounds) - 1}.")
    rnd = rounds[idx]
    return await duel(DuelIn(state=rnd["state"], questions=rnd["questions"], gold=rnd["gold"],
                             contenders=body.contenders, game=game, round=idx, tag=rnd.get("tag"),
                             run=body.run))


WARM_STATES = [
    "Billed twice for March, refund now or we cancel.",       # english checkpoint
    "इस महीने मुझसे दो बार पैसे काटे गए। मेरा पैसा वापस करो।",  # multilingual checkpoint
]


@app.post("/api/warmup")
async def warmup(body: RoundIn):
    """Three calls per contender per warm state, using the real triage question set."""
    from games import TRIAGE_Q
    names = pick(body.contenders)
    out = {}
    for n in names:
        lat = []
        for st in WARM_STATES:
            for _ in range(3):
                lat.append((await ask(n, st, TRIAGE_Q))["latency_ms"])
        out[n] = [round(x) for x in lat[-3:]]
    return out


# ------------------------------------------------------------------- Snake
DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}


class SnakeIn(BaseModel):
    contender: str
    w: int
    h: int
    snake: list[list[int]]  # head first
    food: list[int]
    direction: str
    run: str | None = None
    board: int = 0


# Short, contrastive option text, picked by sweeping wordings over full games on both models.
# Earlier wordings made Laya pick deadly moves (52% of risky spots) or wander between
# "safe, closer" and "safe, away" (1 food in 150 ticks), and "away from the food" lost to
# "crash and die" when it was the only safe move (38% deaths; "safe detour": 2%).
# Instruction and option text were swept together over positions where only a detour is
# safe, where crashes are near, and open board: this pair scored 96% / 100% / 100% on Laya.
# "dead end" is a flood fill: the move leaves less room than the snake needs.
OUTCOME = {"die": "crash and die", "trap": "walk into a dead end", "food": "eat the food",
           "closer": "toward the food", "away": "safe detour"}


def free_room(body, start, w, h):
    """Cells reachable from `start` once the tail has moved one step."""
    blocked = {tuple(p) for p in body[:-1]}
    seen, stack = {tuple(start)}, [tuple(start)]
    while stack:
        x, y = stack.pop()
        for dx, dy in DIRS.values():
            n = (x + dx, y + dy)
            if 0 <= n[0] < w and 0 <= n[1] < h and n not in blocked and n not in seen:
                seen.add(n)
                stack.append(n)
    return len(seen)


def classify_move(s: SnakeIn, name):
    dx, dy = DIRS[name]
    hx, hy = s.snake[0]
    nx, ny = hx + dx, hy + dy
    if not (0 <= nx < s.w and 0 <= ny < s.h) or [nx, ny] in s.snake[:-1]:
        return "die"
    if free_room([[nx, ny]] + s.snake, [nx, ny], s.w, s.h) < len(s.snake) + 1:
        return "trap"
    if [nx, ny] == s.food:
        return "food"
    before = abs(hx - s.food[0]) + abs(hy - s.food[1])
    after = abs(nx - s.food[0]) + abs(ny - s.food[1])
    return "closer" if after < before else "away"


@app.post("/api/snake")
async def snake(s: SnakeIn):
    if s.contender not in CONTENDERS:
        raise HTTPException(400, "Unknown contender.")
    state = {"head": s.snake[0], "food": s.food}
    q = {"move": {"type": "choice",
                  "instructions": "Pick the best move for the snake: move toward the food, and avoid crashing.",
                  "criteria": {d: OUTCOME[classify_move(s, d)] for d in DIRS}}}
    res = await ask(s.contender, state, q, "snake")
    res["options"] = {d: classify_move(s, d) for d in DIRS}
    rec = {**res, "answers": {**(res.get("answers") or {}), "_options": res["options"], "_len": len(s.snake)}}
    record("snake", s.board, None, rec, s.run)
    return res


# ------------------------------------------------------------------- Speed race
SPEED_Q = {"dept": {"type": "choice", "instructions": "Which team should handle this?",
                    "criteria": {"billing": "payments, refunds", "technical": "bugs, outages"}}}


class SpeedIn(BaseModel):
    contender: str
    i: int = 0
    run: str | None = None


@app.post("/api/speed")
async def speed(s: SpeedIn):
    if s.contender not in CONTENDERS:
        raise HTTPException(400, "Unknown contender.")
    res = await ask(s.contender, "Billed twice for March, refund now or we cancel.", SPEED_Q)
    record("speed", s.i, None, res, s.run)
    return {"latency_ms": res["latency_ms"], "error": res.get("error")}


# ------------------------------------------------------------------- Blind arena
class VoteIn(BaseModel):
    a: str
    b: str
    winner: str  # contender name, or "tie"


@app.post("/api/vote")
async def vote(v: VoteIn):
    if v.a not in CONTENDERS or v.b not in CONTENDERS or v.winner not in (v.a, v.b, "tie"):
        raise HTTPException(400, "Bad vote.")
    with db() as con:
        con.execute("INSERT INTO votes(ts,a,b,winner) VALUES(?,?,?,?)", (time.time(), v.a, v.b, v.winner))
    return elo()


def elo():
    ratings = {k: 1000.0 for k in CONTENDERS}
    counts = {k: 0 for k in CONTENDERS}
    with db() as con:
        for row in con.execute("SELECT a,b,winner FROM votes ORDER BY id"):
            a, b = row["a"], row["b"]
            ea = 1 / (1 + 10 ** ((ratings[b] - ratings[a]) / 400))
            sa = 0.5 if row["winner"] == "tie" else float(row["winner"] == a)
            ratings[a] += 32 * (sa - ea)
            ratings[b] += 32 * ((1 - sa) - (1 - ea))
            counts[a] += 1
            counts[b] += 1
    return {k: {"elo": round(ratings[k]), "votes": counts[k]} for k in CONTENDERS}


# ------------------------------------------------------------------- Scoreboard
def pct(xs, q):
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, math.ceil(q * len(xs)) - 1))]


@app.get("/api/scoreboard")
async def scoreboard(game: str | None = None, run: str | None = None):
    where, args = [], []
    if game:
        where.append("game=?"); args.append(game)
    if run:
        where.append("run=?"); args.append(run)
    sql = "SELECT * FROM calls" + (" WHERE " + " AND ".join(where) if where else "")
    with db() as con:
        rows = con.execute(sql, args).fetchall()
    agg = {}
    for r in rows:
        a = agg.setdefault(r["contender"], {"calls": 0, "errors": 0, "lat": [], "correct": 0, "graded": 0,
                                            "p_true": [], "brier": [], "abs_err": [], "tokens": 0,
                                            "by_tag": {}})
        a["calls"] += 1
        a["lat"].append(r["latency_ms"])
        if r["error"]:
            a["errors"] += 1
        u = json.loads(r["usage"] or "null") or {}
        a["tokens"] += (u.get("input_tokens") or 0) + (u.get("output_tokens") or 0)
        for g in (json.loads(r["grade"] or "null") or {}).values():
            a["graded"] += 1
            a["correct"] += bool(g.get("correct"))
            if g.get("p_true") is not None:
                a["p_true"].append(g["p_true"])
            if g.get("brier") is not None:
                a["brier"].append(g["brier"])
            if g.get("abs_err") is not None:
                a["abs_err"].append(g["abs_err"])
            if r["tag"]:
                t = a["by_tag"].setdefault(r["tag"], [0, 0])
                t[0] += bool(g.get("correct"))
                t[1] += 1
    mean = lambda xs: statistics.fmean(xs) if xs else None
    out = {}
    for k, a in agg.items():
        ok_lat = a["lat"]
        out[k] = {"calls": a["calls"], "error_rate": a["errors"] / a["calls"],
                  "accuracy": a["correct"] / a["graded"] if a["graded"] else None, "graded": a["graded"],
                  "p_true": mean(a["p_true"]), "brier": mean(a["brier"]), "score_mae": mean(a["abs_err"]),
                  "p50": pct(ok_lat, 0.5), "p95": pct(ok_lat, 0.95), "tokens": a["tokens"],
                  "by_tag": {t: v[0] / v[1] for t, v in a["by_tag"].items()}}
    return {"game": game, "contenders": out, "elo": elo(), "routed": routed_by(rows)}


def routed_by(rows):
    out = {}
    for r in rows:
        if r["routed"]:
            out.setdefault(r["contender"], set()).add(r["routed"])
    return {k: sorted(v) for k, v in out.items()}


@app.get("/api/results/{game}")
async def saved_results(game: str):
    """Latest saved answer per (round, contender), so the UI can restore a game."""
    out = {}
    with db() as con:
        for r in con.execute("SELECT * FROM calls WHERE game=? ORDER BY id", (game,)):
            out.setdefault(str(r["round"]), {})[r["contender"]] = {
                "contender": r["contender"], "latency_ms": r["latency_ms"], "error": r["error"],
                "answers": json.loads(r["answers"] or "null"), "grade": json.loads(r["grade"] or "null"),
                "routed": r["routed"]}
    return out


@app.delete("/api/results")
async def reset(game: str | None = None):
    with db() as con:
        if game:
            con.execute("DELETE FROM calls WHERE game=?", (game,))
        else:
            con.execute("DELETE FROM calls")
            con.execute("DELETE FROM votes")
    return {"ok": True}


class RunIn(BaseModel):
    contenders: list[str]


@app.post("/api/runs")
async def new_run(body: RunIn):
    rid = time.strftime("%Y%m%d-%H%M%S")
    with db() as con:
        con.execute("INSERT INTO runs(id,ts,contenders) VALUES(?,?,?)",
                    (rid, time.time(), json.dumps(pick(body.contenders))))
    return {"run": rid}


class ReportIn(BaseModel):
    report: dict


@app.put("/api/runs/{rid}")
async def save_report(rid: str, body: ReportIn):
    with db() as con:
        con.execute("UPDATE runs SET report=? WHERE id=?", (json.dumps(body.report), rid))
    return {"ok": True}


@app.get("/api/runs/latest")
async def latest_run():
    with db() as con:
        r = con.execute("SELECT * FROM runs WHERE report IS NOT NULL ORDER BY ts DESC LIMIT 1").fetchone()
    return {"run": r["id"], "report": json.loads(r["report"])} if r else {"run": None}


@app.get("/api/random-pair")
async def random_pair(contenders: str = "jev,laya"):
    names = pick(contenders.split(","))
    if len(names) < 2:
        raise HTTPException(400, "Blind arena needs two contenders.")
    a, b = random.sample(names, 2)
    return {"a": a, "b": b}


# ------------------------------------------------------------------- static UI
app.mount("/static", StaticFiles(directory=ROOT / "web"), name="static")


@app.get("/")
async def index():
    return FileResponse(ROOT / "web" / "index.html")
