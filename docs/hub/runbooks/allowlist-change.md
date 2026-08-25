# Runbook: private OAuth allowlist change

> **Status:** Current private-V1 procedure
> **Owner:** Campaign Hub operator

## Add

1. Obtain the immutable numeric GitHub user id, not login/username.
2. Record approved requester, purpose, expiry/review date.
3. Add `github:<numeric id>` to `HUB_ALLOWED_OAUTH_SUBJECTS`.
4. Restart/promote BFF configuration.
5. Verify allowlisted sign-in and an unallowlisted rejection.

## Remove

1. Remove the subject and restart/promote configuration.
2. Revoke the account's active sessions through the account/device flow or authoritative operator procedure.
3. Confirm sockets close and reauthentication returns `ACCOUNT_NOT_ALLOWED`.
4. Decide whether memberships/account data remain, transfer/archival is needed, or the user requests deletion.

Changing the allowlist does not itself delete data or revoke existing sessions already in the database.

Never store usernames as allowlist identity; renamed names can be reclaimed.
