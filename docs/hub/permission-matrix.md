# Campaign Hub permission matrix

> **Status:** Current private-V1 authorization
> **Last verified:** 2026-08-24
> **Owner:** Campaign Hub maintainers

The server checks active membership, role, tenant, object ownership, status, and write preconditions. Client UI
visibility is not authorization.

| Operation | Campaign owner/DM | Co-DM | Player | Spectator |
|---|---:|---:|---:|---:|
| Read campaign metadata/members/context | Yes | Yes | Yes | Yes |
| Create campaign | Yes (becomes owner/DM) | N/A | Yes (becomes owner/DM) | Yes (becomes owner/DM) |
| Archive campaign | Owner only | No | No | No |
| Transfer campaign ownership | Owner only | No | No | No |
| Create invite | Yes | Yes | No | No |
| List/revoke invites | Yes | Yes | No | No |
| Change member role | Owner only | No | No | No |
| Remove member | Any non-owner | Player/spectator only | No | No |
| Leave campaign | Owner must transfer/archive first | Yes | Yes | Yes |
| Publish/activate rules or brew | Yes | Yes | No | No |
| Read full campaign character | Any campaign character | Any campaign character | Own only | Own only if one already exists |
| Read peer character profile | Yes, beside truth as `peerPreview` | Yes, beside truth as `peerPreview` | Yes | Yes |
| Read own sharing policy | Own character only | Own character only | Own character only | Own character only |
| Read another member's sharing policy | No | No | No | No |
| Change sharing policy | Own character only | Own character only | Own character only | Own character only |
| Create campaign character | Own character | Own character | Own character | No |
| Edit character under lease | Own character only | Own character only | Own character only | No while spectator |
| Clone/move character into campaign | Own character only | Own character only | Own character only | No |
| Archive character | Own character only | Own character only | Own character only | Own character only |
| Read/create private DM workspace | Own workspace | Own workspace | No | No |
| Read another DM's workspace | No | No | No | No |
| Log roll | Yes | Yes | Yes | No |
| Create structured effect proposal | Yes | Yes | Yes | No |
| Accept/reject targeted effect | Override or target owner | Override or target owner | Target owner | No |
| Grant XP/item | Yes | Yes | No | No |
| Read party inventory | Yes | Yes | Yes | Yes |
| Transfer from party inventory | Yes | Yes | No | No |
| Transfer from character | Own character | Own character | Own character | No |
| Resolve transfer to character | Override or target owner | Override or target owner | Target owner | Target owner |
| Resolve transfer to party inventory | Yes | Yes | No | No |
| Read `all_members` event | Yes | Yes | Yes | Yes |
| Read `dm_only` event | Yes | Yes | No | No |
| Read `actor_and_dm` event | Yes | Yes | If actor | No |
| Read `explicit_accounts` event | Yes | Yes | If listed | If listed |

Every HTTP read/write and WebSocket subscription also checks:

- authenticated account/session;
- active membership;
- matching `campaign_id`;
- object ownership where required;
- object status (active/archived/revoked);
- revision/lease/fencing preconditions for writes.

WebSocket messages/fanout recheck session and membership. Member removal/leave additionally closes that
account's campaign sockets immediately after the authoritative transaction commits.

## Important distinctions

- DM role does not permit direct document editing of another player's character. DM changes use explicit
  grants/effects/transfers.
- Campaign owner is an account field on the campaign, not a separate role string.
- Co-DM can perform DM content/grant/workspace operations but cannot transfer ownership or archive as owner.
- Spectator is an authenticated read-only campaign role in current mutation paths.
- Action resolution is explicitly limited to DM/co-DM/player before the target-owner check. Transfer
  resolution has no equivalent role list and therefore still permits a spectator who owns the target
  character to accept/reject that transfer. This asymmetry is current behavior, not a general role rule.
- Account deletion-pending sessions may read session/deletion state, export, cancel deletion, or logout;
  ordinary campaign routes return `ACCOUNT_DELETION_PENDING`.
