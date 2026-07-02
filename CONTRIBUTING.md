# Contributing

Thanks for improving Family Command Center. This project is optimized for a single-household production deployment on Vercel but welcomes forks and PRs.

## Development

The primary path is **production deployment** — see [docs/SETUP.md](./docs/SETUP.md). Environment variables belong in Vercel, not in committed files.

For code changes, install dependencies and type-check locally:

```bash
npm install
npx tsc --noEmit
```

Lint:

```bash
npm run lint
```

## Adding a chat tool

1. **Define the tool** in the `tools` array in `app/api/chat/route.ts` (name, description, `input_schema`).
2. **Implement execution** in `executeTool()` — same file — with access to `ToolContext` (`supabase`, `userId`, `pushedBy`).
3. **Update the system prompt** in `buildSystemPrompt()` so Claude knows when to use the tool.
4. Document the tool in `docs/ARCHITECTURE.md` and `docs/PRD.md` if behavior is user-facing.

Pattern:

```typescript
if (name === "my_new_tool") {
  const input = input as { ... };
  // ... logic ...
  return { success: true };
}
```

Tools return JSON-serializable objects passed back to Claude as `tool_result` content.

## Adding a UI tab

1. Extend the `Tab` union in `components/command-center.tsx`.
2. Add a nav item in `BottomNav`.
3. Add conditional render block in the main component (follow Home/Budget/Theo patterns).
4. Add any new API routes under `app/api/` with `export const runtime = "nodejs"` if using Plaid, Coinbase, or Node crypto.

## Adding an API route

- Place under `app/api/your-route/route.ts`.
- Authenticate with `createClient()` + `getUser()` unless it's a cron/webhook with its own secret.
- Set `export const runtime = "nodejs"` when importing from `lib/plaid` or `lib/coinbase-trade`.
- Catalog the route in `docs/ARCHITECTURE.md`.

## Database changes

1. Update `supabase/schema.sql` (use `IF NOT EXISTS` / `DROP POLICY IF EXISTS` for idempotency).
2. Document tables and memory keys in `docs/DATABASE.md`.

## Docs

Keep deployment docs accurate to code — grep `process.env` and `app/api/` when adding features. Production deployment is documented in [docs/SETUP.md](./docs/SETUP.md) and [docs/ENV.md](./docs/ENV.md).

## License

Contributions are released under the same [Unlicense](../LICENSE) as the project.
