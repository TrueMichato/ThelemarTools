# Runbook: retired OAuth allowlist

> **Status:** Retired by ADR 0018
> **Owner:** Campaign Hub operator

`HUB_ALLOWED_OAUTH_SUBJECTS` is no longer account-admission authority and must not be passed to the r9 BFF.
Existing identities sign in normally. A previously unknown identity needs a valid campaign invite bound through
ADR 0018's server-side OAuth context. Retain the old exact values only as input to
`hub:check-auth-rollback` when evaluating a pre-r9 target image.

Keep `HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=false` until the stacked provider-neutral `campaign:create`
entitlement layer, backfill, audited administration, and rollback gate are deployed. Then use campaign invite
creation/revoke and the ordinary session/member lifecycle runbooks; do not admit, remove, or recover an account by
provider subject, email, login, handle, or display name.
