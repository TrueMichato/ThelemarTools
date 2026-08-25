# Runbook: security/privacy/availability incident

> **Status:** Portable incident skeleton
> **Owner:** Named incident commander

## Declare

Declare immediately for:

- suspected cross-campaign/private-field exposure;
- secret/token/backup-key compromise;
- inventory duplication/loss;
- unauthorized lifecycle action;
- restore integrity failure;
- extended outage or RPO/RTO threat.

## Contain

1. Assign commander, scribe, technical lead.
2. Record UTC declaration time and affected environment/build/migration.
3. Preserve logs, request ids, operational evidence, database/provider audit, and image digests.
4. Revoke affected sessions/credentials; freeze campaign/environment mutations when necessary.
5. Do not copy character/brew/token bodies into incident channels.
6. Use rollback/outage/outbox/rotation runbooks as appropriate.

## Assess

- accounts/campaigns/data fields affected;
- earliest/latest exposure;
- canonical vs. live-delivery impact;
- inventory/transaction integrity;
- backup/PITR exposure;
- regulatory/privacy notification need.

## Recover

- deploy reviewed fix/credentials;
- verify tenant authorization, sessions, migrations, outbox, and representative workflows;
- restore only through isolated validation;
- monitor recurrence.

## Close/postmortem

Record timeline, root cause, detection gap, impact, remediation, tests/runbooks/alerts added, owners/deadlines, and
user communication. Update ADRs, traceability, and risk register.
