---
name: chain
version: 0.1.0
description: Inject the 3 most recent session IDs for the current workspace into the prompt before Claude responds. Use when starting work and wanting recent session context.
argument-hint: your question or task (optional)
allowed-tools: Bash(bash ~/.claude/skills/chain/chain-sessions.sh)
---

!`bash ~/.claude/skills/chain/chain-sessions.sh`

$ARGUMENTS
