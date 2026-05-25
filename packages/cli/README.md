# @nimrobo/superdense

[![npm version](https://img.shields.io/npm/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![npm downloads](https://img.shields.io/npm/dm/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![Node.js](https://img.shields.io/node/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![License](https://img.shields.io/npm/l/@nimrobo/superdense)](../../LICENSE)

A local studio + CLI that indexes the session logs your coding agents (Claude Code, Codex, ...) leave behind so you can search, filter, summarize, and replay them.

## Install

```bash
npx @nimrobo/superdense studio
# or
npm i -g @nimrobo/superdense
superdense studio
```

Requires Node 20+.

## Quickstart

```bash
superdense studio                          # local UI at http://127.0.0.1:4242
superdense index                           # incremental re-index
superdense session list --q "billing"
superdense query --query '{"filters":{"filter":{"name":"session","params":{"agent":"codex"}}}}'
superdense saved-query list
superdense saved-query run <id>
superdense compactor run salience <id>
superdense skill install                   # install the superdense skill for Claude + Codex
superdense help
```

All non-`studio` commands emit JSON for agent-friendly piping.

## Links

- Source, docs, issues: https://github.com/nimrobo/superdense
- License: Apache-2.0
