# ADR 0001: Same-origin BFF with managed PostgreSQL

Status: Accepted for implementation

## Context

The hub needs durable accounts, relational campaign membership, multi-device access, ACID inventory
transactions, WebSocket subscriptions, audit, backups, and eventual public-tenancy hardening.
Campaign homebrew is rendered in the application origin, so JavaScript-readable bearer tokens are an
unacceptable session default.

## Decision

Use:

- a same-origin Node.js backend-for-frontend (BFF);
- managed PostgreSQL for canonical product data;
- a server WebSocket endpoint for subscriptions and presence;
- httpOnly, Secure, SameSite session cookies;
- OAuth identities linked to stable internal account ids;
- managed object storage only for large immutable bundle/portrait artifacts.

The PostgreSQL provider is replaceable (for example Supabase Database, Neon, or hosted Postgres). Browser
clients do not connect directly to the database/auth provider and do not store auth JWTs in localStorage.

The BFF owns:

- OAuth callback and session rotation/revocation;
- CSRF and Origin validation;
- authorization and payload validation;
- database transactions;
- WebSocket subscription filtering;
- content import limits;
- export/deletion endpoints.

## Consequences

- The static site and API must be deployed behind one origin/reverse proxy.
- A managed platform's default browser authentication SDK may not be used if it exposes bearer tokens to
  page JavaScript.
- The application gains an operations surface: migrations, monitoring, backup/restore, and availability.
- Tests can use an in-memory authority at the repository boundary; production correctness remains in
  PostgreSQL transactions.

## Rejected alternatives

- PeerJS/WebRTC authority: cannot provide durable accounts or offline access.
- Direct Supabase-style browser data access: conflicts with the chosen session security model and spreads
  authorization across client/RLS policies.
- Durable Objects as the only datastore: poor fit for relational memberships, exports, and multi-aggregate
  inventory transactions. They remain an optional fanout optimization later.
- Self-hosted database for V1: unnecessary operations burden; the BFF remains portable if this changes.
