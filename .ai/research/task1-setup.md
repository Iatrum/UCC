# Task 1 research: agent instruction files + e2e in repo
- Claude Code reads CLAUDE.md; if CLAUDE.md exists AGENTS.md is NOT read unless imported with `@AGENTS.md` (relative to the importing file, max 4 hops). https://code.claude.com/docs/en/memory
- Codex reads AGENTS.md from git root down to cwd, 32 KiB cap. https://learn.chatgpt.com/docs/agent-configuration/agents-md
- Codex `/status` is TUI-only; no headless status. https://github.com/openai/codex/issues/10233 . Rate limits are written into session rollout JSONL (`rate_limits.primary/secondary`, `resets_at` epoch) – verified on box.
- Claude headless limit message can exit 0; check `is_error` + text. https://github.com/anthropics/claude-code/issues/15685
- Next 16: `next dev` -> `.next/dev`, `next build` -> `.next`; concurrent OK. https://nextjs.org/docs/app/api-reference/cli/next
- Repo: tsconfig.lint.json includes `**/*.ts`, so `e2e/**` must be excluded or the app lint pulls in Playwright files.
