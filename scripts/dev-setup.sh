#!/usr/bin/env bash
# One-time developer setup: session capture (Entire) and session tracing (neatlogs)
# for Claude Code in this repository. Reads the neatlogs key from .env.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then echo "missing .env (see .env.example)"; exit 1; fi
set -a; . ./.env; set +a

# Entire: hooks for Claude Code + git hooks; checkpoints on a branch GitHub can display
entire enable --agent claude-code --checkpoint-backend branch --project

# entire-graph: code graph plugin + operating guide in AGENTS.md / CLAUDE.md
entire plugin install graph || true
entire graph init-agents --repo .

# neatlogs: trace Claude Code sessions (key is stored in ~/.config/neatlogs, not in the repo)
npm install -g @neatlogs/claude-code
neatlogs-claude-code setup --project --api-key "$NEATLOGS_API_KEY"

echo
echo "done. hooks apply to Claude Code sessions started after this point."
