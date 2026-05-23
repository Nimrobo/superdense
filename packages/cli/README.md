# @nimrobo/road42

> *"The Answer to the Ultimate Question of Life, the Universe, and what your coding agent was actually doing."*

A local studio + CLI that indexes the session logs your coding agents (Claude Code, Codex, ...) leave behind so you can search, filter, summarize, and replay them.

## Why "42"?

42 is the Answer to the Ultimate Question of Life, the Universe, and Everything, per Deep Thought in *The Hitchhiker's Guide to the Galaxy*. The trouble in the book is that nobody knew the Question. Same energy here: your agents have already produced the answers — Road42 helps you ask better questions of them. Don't panic.

## Install

```bash
npx @nimrobo/road42 studio
# or
npm i -g @nimrobo/road42
road42 studio
```

Requires Node 20+.

## Quickstart

```bash
road42 studio                          # local UI at http://127.0.0.1:4242
road42 index                           # incremental re-index
road42 session list --q "billing"
road42 query list
road42 query run <id>
road42 compactor run salience <id>
road42 skill install                   # install the road42 skill for Claude + Codex
road42 help
```

All non-`studio` commands emit JSON for agent-friendly piping.

## Links

- Source, docs, issues: https://github.com/nimrobo/road42
- License: Apache-2.0
