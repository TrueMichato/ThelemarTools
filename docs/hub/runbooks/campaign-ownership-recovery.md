# Runbook: campaign ownership recovery

> **Status:** Current private-V1 procedure
> **Owner:** Campaign Hub operator

## Normal transfer

The current owner transfers ownership only to an active DM/co-DM membership. The target becomes DM and the
previous owner becomes co-DM. Verify campaign owner id and both roles after the audited command.

## Owner wants to leave/delete

1. Export account data.
2. Transfer each active campaign to an active DM/co-DM, or archive the campaign.
3. Verify no active owned campaign remains.
4. Then leave/request account deletion.

## Incapacitated/unavailable owner

Private V1 has no unaudited operator override endpoint. Do not edit owner/roles directly without:

- incident/support record and owner identity evidence;
- explicit user authorization or documented emergency policy;
- a reviewed one-off transaction that preserves one owner/DM, audit, event, and outbox semantics;
- post-change verification and follow-up issue for an authoritative recovery feature if this recurs.

Public onboarding requires a formal recovery policy before launch.
