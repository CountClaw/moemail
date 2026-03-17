# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands (pnpm)

Repo includes both `pnpm-lock.yaml` and `package-lock.json`, but pnpm is the documented and CI-used package manager.

- Install dependencies:
  - `pnpm install`
- Run dev server (Next.js):
  - `pnpm dev`
- Lint:
  - `pnpm lint`
- Build / run locally:
  - `pnpm build`
  - `pnpm start`

### Cloudflare Pages build/deploy

- Build output for Cloudflare Pages (uses `@cloudflare/next-on-pages`):
  - `pnpm build:pages`
- Deploy Pages from local:
  - `pnpm deploy:pages`

### Database (Cloudflare D1 + Drizzle)

- Local migrations (requires `wrangler.json`):
  - `pnpm db:migrate-local`
- Remote migrations:
  - `pnpm db:migrate-remote`

### Workers (Wrangler)

Wrangler configs are JSON and typically created from the `wrangler.*.example.json` files:
- `wrangler.json` (Pages app bindings: D1 + KV)
- `wrangler.email.json` (email receiver worker)
- `wrangler.cleanup.json` (scheduled cleanup worker)

Commands:
- Deploy email receiver worker:
  - `pnpm deploy:email`
- Run cleanup worker locally (scheduled events enabled) and trigger it:
  - `pnpm dev:cleanup`
  - `pnpm test:cleanup`  (hits `http://localhost:8787/__scheduled`)
- Deploy cleanup worker:
  - `pnpm deploy:cleanup`

### Local utilities

- Run a local webhook receiver for testing (requires Bun):
  - `pnpm webhook-test-server` (listens on `http://localhost:3001`)
- Generate mock mailboxes/messages (runs via wrangler):
  - `pnpm generate-test-data`

### End-to-end deployment script

- Full Cloudflare setup + deploy (used by GitHub Actions):
  - `pnpm dlx tsx scripts/deploy/index.ts`

## High-level architecture

### Runtime targets

This is a Next.js App Router application deployed to Cloudflare Pages (via `@cloudflare/next-on-pages`). It also deploys two Cloudflare Workers:
- Email receiver worker for Cloudflare Email Routing (`workers/email-receiver.ts`)
- Scheduled cleanup worker (`workers/cleanup.ts`, cron configured in `wrangler.cleanup*.json`)

Cloudflare storage used:
- D1 (SQLite) for primary data (emails/messages/users/etc.)
- KV (`SITE_CONFIG`) for site-wide configuration (default role, email domains, admin contact, send-email settings, etc.)

### Web app structure (Next.js)

- App Router lives under `app/`.
- Locale-aware UI uses a `[locale]` segment (`app/[locale]/...`) and `next-intl` (plugin configured in `next.config.ts`).
- Many route handlers/pages declare Edge runtime (`export const runtime = 'edge'`), so avoid Node-only APIs in request-time code.

### Request routing and auth

- `middleware.ts` is a key control point:
  - For `/api/**`, it enforces authentication/authorization.
    - Allows NextAuth endpoints under `/api/auth/**`.
    - Supports API key auth via `X-API-Key` header (delegates to `app/lib/apiKey.ts`).
    - Otherwise requires a NextAuth session (via `app/lib/auth.ts`) and checks RBAC permissions.
  - For non-API routes, it ensures locale prefixes (redirects based on cookie / `Accept-Language`).

### API routes

- API route handlers are under `app/api/**/route.ts`.
- Notable areas:
  - Email mailbox + message APIs under `app/api/emails/**`
  - Webhook config + test endpoints under `app/api/webhook/**`
  - Site config endpoints under `app/api/config/**` (KV-backed)
  - Auth endpoint `app/api/auth/[...auth]/route.ts` re-exports NextAuth handlers from `app/lib/auth.ts`

### Data access and schema

- Drizzle schema is defined in `app/lib/schema.ts`.
  - Includes MoeMail domain tables (emails/messages/webhooks/api keys/share links) plus NextAuth-related tables and RBAC tables.
- DB access is via `app/lib/db.ts` (Drizzle + Cloudflare Pages request context env).
- Migrations:
  - Drizzle-kit config is `drizzle.config.ts`.
  - Migration artifacts are in `drizzle/`.
  - `scripts/migrate.ts` generates migrations (`drizzle-kit generate`) and applies them via `wrangler d1 migrations apply`.

### Workers

- `workers/email-receiver.ts`
  - Handles Cloudflare Email Routing `email()` events.
  - Parses incoming raw email, finds the mailbox, inserts a new message record in D1.
  - If webhook notifications are enabled, it POSTs a webhook event.
- `workers/cleanup.ts`
  - Handles scheduled events (cron) and deletes expired emails/messages in D1.

### Webhooks

- Webhook delivery logic (timeout + retries) is in `app/lib/webhook.ts`.
- API configuration endpoints are in `app/api/webhook/**`.

### Sending emails (Resend)

- Sending is implemented in `app/api/emails/[id]/send/route.ts`.
- The feature is controlled by KV keys (including `RESEND_API_KEY`, enable flag, and role limits); enforcement lives in `app/lib/send-permissions.ts`.

## Important config files

- `next.config.ts`: Next.js config + Cloudflare dev platform setup (`setupDevPlatform`) + PWA + next-intl plugin.
- `wrangler*.example.json`: templates for Pages app + workers (D1/KV bindings and worker entrypoints).
- `.env.example`: env vars used by deploy scripts and auth providers.
- `types.d.ts`: declares Cloudflare `Env` typings (`DB`, `SITE_CONFIG`) and augments NextAuth user/session types.
- `.github/workflows/deploy.yml`: tag/manual-triggered deployment that runs `scripts/deploy/index.ts`.
