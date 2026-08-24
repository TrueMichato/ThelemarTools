# ADR 0007: Administrative lifecycle and seven-day account deletion

Status: Accepted for Phase 6B; implementation pending

## Context

Private V1 currently creates invites and memberships and can export account data, archive campaigns, and
transfer campaign ownership. It does not yet list/revoke invites, change/remove members, manage sessions, or
delete accounts. Direct database intervention would bypass leases, escrow, WebSockets, audit, and character
ownership.

## Decision

1. Add authoritative, audited invite revocation, member role change/removal, and session revocation.
2. Member removal transactionally:
   - revokes leases and live authorization;
   - cancels incoming actions/transfers;
   - restores outgoing escrow;
   - detaches owned campaign characters to personal ownership;
   - archives the membership's private DM workspace;
   - emits audit/domain/outbox records.
3. The campaign owner cannot be removed and the last DM invariant cannot be violated.
4. Add user-requested account deletion:
   - export offered first;
   - active campaign ownership blocks the request;
   - request enters a 7-day grace state;
   - normal sessions/mutations are revoked/frozen;
   - reauthentication permits only export/cancellation during grace;
   - cancellation is allowed before purge starts;
   - purge removes identities, sessions, memberships, private workspaces, owned characters, and personal data;
   - actor references required for tenant audit are nulled/anonymized.
5. Backups age deleted data out according to documented backup retention; deletion cannot rewrite old immutable
   backup archives.

## Consequences

- Account status gains a deletion lifecycle and maintenance worker dependency.
- The account page becomes a restricted surface during grace.
- Deletion and removal require explicit cross-table impact tests.
- Privacy documentation must disclose DM full-sheet access, export content, grace, purge, and backup aging.

## Rejected alternatives

- Immediate hard delete: unsafe ownership/escrow/recovery semantics.
- Operator-only deletion: unacceptable durable dependency for a user-controlled account.
- Cascade-delete campaign characters on member removal: violates player ownership and risks data loss.
