# Workspace Rules — Southern Border Intelligence Report (IPB)

## Department Deployment (Auto-Commit & Push)
- This repository powers the department's shared GitHub Pages app (`.github/workflows/deploy-pages.yml` deploys automatically on push to `main`).
- After completing **any** code, parser, or UI fix, always verify and immediately stage, commit, and push to `origin main` without waiting for a separate prompt.
- Stage only the intended source/test/config files (never commit scratch logs, `.env`, or credentials).
- In the final reply, include the commit hash, pushed branch (`origin/main`), and a brief reminder that GitHub Pages refreshes in ~1–2 minutes (use `Ctrl+F5` if cached).

## Verification & OPSEC Gate (Required Before Every Commit)
- Run `npm test`, `npm run build`, and `gitleaks dir src --config .gitleaks.toml --redact=100` after edits and before committing; fix any failure before pushing.
- **OPSEC:** Never place real operational incident records from user messages, real names/IDs, or live Google Apps Script `/exec` URLs in source files, tests, or commit messages. All unit tests must use synthetic data only.

## Area Granularity & Fallback Invariants
- Never fabricate a default `district` or `subdistrict` when only a province (or province + district) is known; preserve empty string `""` for missing levels across `matchAreaByThaiNames`, multi-area parsing, and `parsePulledGasResponse`.
- When jumping to a fallback pin via `getCenterOfArea` or UI crosshair actions, cascade safely up to the most specific valid level (`subdistrict` -> `district` -> `province`) rather than failing silently.
