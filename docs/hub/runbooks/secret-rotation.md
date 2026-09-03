# Runbook: secret rotation

> **Status:** Portable procedure applicable to Oracle staging
> **Owner:** Campaign Hub operator

## General

- create independent replacement values;
- update secret manager/runtime atomically;
- never print values to logs/tickets/shell history;
- record name/version/time/operator, not value;
- restart affected jobs/services and verify.

## Cookie secret

- invalidates signed session/OAuth cookies;
- all users sign in again;
- rotate BFF, verify old cookies fail and new cookies carry Secure/httpOnly/SameSite/Path.

## CSRF secret

- invalidates issued CSRF tokens;
- changes deterministic invite derivation for retries;
- existing raw invite links still match stored hashes;
- old invite-creation idempotency retries cannot reproduce the original token;
- refresh sessions/pages and verify mutation/invite behavior.

## GitHub OAuth secret

- rotate provider and BFF secret together;
- verify callback URL, PKCE, allowlist, session rotation, and GitHub egress.
- a provider-local rotation failure must not alter identity rows or persist failed token responses;
- when multiple providers exist, verify unaffected registry entries remain available before disabling the failed
  entry.

## Database credentials

- rotate owner/runtime/backup/operations separately;
- BFF uses runtime only;
- migration/grant jobs use owner;
- backup uses backup + operations writer;
- verify role boundaries after rotation.

## Backup encryption key

- new backups use new key;
- retain old keys for every retained archive;
- test restore with each active key version;
- never rotate by re-encrypting in place without preserving source/evidence.

## Metrics token

- rotate monitoring and BFF together;
- verify wrong/old token returns 401 and correct token exposes only aggregate metrics.
