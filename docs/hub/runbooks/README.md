# Campaign Hub runbooks

> **Status:** Runbook index; detailed provider-portable runbooks are Phase 6E deliverables
> **Last reviewed:** 2026-08-24
> **Owner:** Campaign Hub maintainers

Runbooks are executable operational procedures. Each final runbook must contain:

- purpose and severity;
- prerequisites/permissions;
- safety warnings and stop conditions;
- exact provider-portable checks;
- ordered actions;
- verification and user-impact checks;
- rollback/recovery;
- evidence to record;
- escalation/owner;
- last drill date.

## Current procedure

- [Current setup, backup, restore, retention, and rotation](../operations.md)

## Required before private launch

- deploy and promote;
- rollback application image;
- backup and isolated restore;
- migration failure;
- database outage;
- stuck/failed outbox;
- session/OAuth compromise;
- cookie/CSRF/OAuth/database secret rotation;
- allowlist change;
- member removal with active resources;
- account deletion/cancellation/purge;
- campaign ownership recovery;
- incident declaration, containment, evidence, and postmortem.

Until these exist and have been drilled, do not represent the implementation as operationally launch-ready.
