# Security Policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/soummyaanon/jev-vs-laya/security/advisories/new)
instead. You'll get a response as soon as possible.

## Keeping your keys safe

- Your `TYPESAFE_API_KEY` belongs in `.env`, which is git-ignored. Never commit it or paste it in an issue.
- The arena keeps keys on the backend; the browser never receives them. Keep it that way in PRs.
- The arena binds to localhost. If you expose it or `laya-serve` on a network, set `LAYA_API_KEY`
  and put the arena behind authentication.
