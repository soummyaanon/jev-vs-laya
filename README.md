# Jev vs Laya · Battleground

An arena where two AI classifiers get byte-identical inputs and are scored against one answer key:
**Jev** (TypeSafe's hosted System One model) and **Laya** (open source, Apache 2.0, self-hosted).

Both speak the same wire protocol, `POST /v1/systemone`: send a state and typed questions
(`choice`, `score`, `noul`), get back structured answers with a probability for every option.

## Run it

```bash
python3.11 -m venv .venv-laya && source .venv-laya/bin/activate
pip install -r requirements.txt
cp .env.example .env        # add your TYPESAFE_API_KEY
./start.sh                  # Laya on :8000, arena UI on http://localhost:9000/#battleground
```

`start.sh` defaults to `LAYA_DEVICE=mps` (Apple GPU). Use `LAYA_DEVICE=cuda` or `cpu` elsewhere.
The first run downloads Laya's three checkpoints (~2.3 GB) from Hugging Face.

## Games

| Game | What it tests |
|---|---|
| Triage Duel | 40 support tickets: department, urgency, churn risk, refund request |
| Language Gauntlet | 5 tickets in English, Hindi, Hinglish, Bengali, French, Arabic, Swahili |
| Prompt Safety | Benign prompts mixed with injection, persona and data-exfiltration attempts |
| Big Menu | One choice over 50 banking intents |
| Snake Duel | Each tick is a typed choice over four moves; a flood fill flags dead ends |
| Speed Race | The same single-question call, repeated: p50 / p95 latency |
| Blind Arena | Names hidden, humans vote, Elo ratings |

**Battleground** (`#battleground`) runs every game live in one click and builds a downloadable report card.

## Scoring

- Accuracy against the answer key, plus the probability each model gave the correct answer (p(true))
  and Brier score for calibration. Self-reported confidence is not compared: each model computes it differently.
- Noul questions use neutral A/B labels, every score level is described, choice keys are semantic.
- Laya auto-routes per request; Snake uses its `typed-decisions` checkpoint.

## Caveats

Datasets are small and hand-labelled, so treat results as a battleground, not a benchmark.
Latency depends on where each model runs. Snake measures how well a model follows typed options,
and it is sensitive to option wording.

## Layout

`arena.py` FastAPI backend (keeps API keys server-side) · `games.py` datasets · `web/` UI · results in `arena.db` (SQLite, git-ignored).
