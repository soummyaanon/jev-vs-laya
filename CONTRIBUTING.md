# Contributing

Thanks for helping make the battleground better. Every kind of contribution counts:
new games, better datasets, bug fixes, UI polish, docs, and reports of weird model behaviour.

## Ground rules

- **Keep it fair.** Both contenders must receive byte-identical input. Never tune a prompt or a dataset
  for one model only. If you change question wording, check it on every contender and say so in the PR.
- **Never commit secrets.** API keys live in `.env`, which is git-ignored. Double-check before pushing.
- **Keep it hackable.** No build step for the UI, no heavy frameworks. Plain Python and plain JS.

## Local setup

```bash
python3 -m venv .venv-laya && source .venv-laya/bin/activate
pip install -r requirements.txt
cp .env.example .env    # add TYPESAFE_API_KEY
./start.sh              # Laya on :8000, arena on :9000
```

Restart the arena after changing `arena.py` or `games.py`. UI files are served straight from `web/`
with caching disabled, so a browser refresh picks up changes.

## Adding a game

1. **Dataset.** In `games.py`, write a function that returns rounds shaped `{state, questions, gold}`,
   then register it in `GAMES`. Use the question-type rules below.
2. **Sidebar note.** Add an entry to `NOTES` in `web/app.js` (same `id` as your `GAMES` key).
3. **Battleground.** Add the id to `SIM_GAMES` and a short name to `SHORT` in `web/sim.js`
   if it should run in the one-click battle and appear on the report card.

Question-type rules (from the fairness guide):

- `choice`: semantic keys (`billing`, `technical`), never `yes`/`no` or `true`/`false`. Keep it to 20 options or fewer
  unless the game is specifically about large label spaces.
- `score`: every level needs a description.
- `noul`: use the `noul()` helper in `games.py`, which applies neutral A/B labels.

## Pull requests

- One focused change per PR, with a short description of what and why.
- If results change, paste the before/after numbers and say how many rounds you ran.
- Make sure CI passes (`python -m py_compile arena.py games.py` and `node --check web/*.js`).

## Reporting bugs

Open an issue with steps to reproduce, which contender(s) were enabled, and the relevant lines
from `arena.log` or `laya.log`. Remove any API keys from logs before pasting.
