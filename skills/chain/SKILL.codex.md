---
name: chain
version: 0.1.0
description: Load recent Superdense session IDs for the current workspace before continuing the user's task. Use when starting work that should build on recent agent sessions.
---

# Chain Session Context

When this skill is invoked, run the bundled script first and show its output before answering the user's task.

## Workflow

1. Run the script from this installed skill directory. Prefer the local install path when it exists, otherwise use the global install path:

   ```bash
   if [ -f ./.codex/skills/chain/chain-sessions.sh ]; then
     bash ./.codex/skills/chain/chain-sessions.sh
   else
     bash ~/.codex/skills/chain/chain-sessions.sh
   fi
   ```

2. Output the script's `<past_sessions>` block exactly as returned.

3. Continue with the user's request after the block.

Do not run any compactor automatically. If no sessions are found, still output the script's no-sessions block and then continue with the user's request.
