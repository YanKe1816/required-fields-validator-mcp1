# Required Fields Validator

A single-tool Cloudflare Workers + TypeScript MCP server.

## Routes

- `GET /` — app home page
- `GET /privacy` — privacy policy
- `GET /terms` — terms of service
- `GET /support` — support information
- `GET /health` — JSON health check
- `GET /.well-known/openai-apps-challenge` — raw challenge value from `OPENAI_APPS_CHALLENGE`
- `POST /mcp` — MCP JSON-RPC endpoint supporting `initialize`, `tools/list`, and `tools/call`

## Tool

`validate_required_fields` checks whether submitted field data contains every required field and returns a deterministic structured result. It does not submit forms, approve requests, send messages, or modify external systems.

## Local checks

```sh
npm install
npm run typecheck
npm test
```

Run locally with:

```sh
npx wrangler dev
```
