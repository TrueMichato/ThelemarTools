# Runbook: session or device compromise

> **Status:** Current private-V1 procedure
> **Last drilled:** 2026-08-24 in API tests
> **Owner:** Campaign Hub operator

## User containment

From `hub.html`:

- revoke one non-current device; or
- sign out all other devices.

Logout revokes the current session. Reauthentication rotates the previous browser session found during OAuth.

## Authority effects

Session revocation:

- sets `revoked_at`;
- removes character/workspace leases held by that session;
- closes matching WebSockets;
- writes audit and idempotent receipt for account-management routes.

## Verify

- revoked session appears revoked in device list;
- its cookie receives `AUTH_REQUIRED`;
- its WebSocket closes with policy code;
- former leases cannot write and a new device can acquire/take over explicitly;
- unrelated account sessions remain active.

## Secret compromise

If cookie signing, CSRF, OAuth, or database credentials may be compromised, follow the broader secret-rotation
and incident runbooks when Phase 6E completes them. Do not treat per-session revocation as sufficient.
