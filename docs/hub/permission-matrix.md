# Campaign Hub permission matrix

> **Status:** Current private-V1 authorization
> **Last verified:** 2026-09-04
> **Owner:** Campaign Hub maintainers

The server checks active membership, role, tenant, object ownership, status, and write preconditions. Client UI
visibility is not authorization.

| Operation | Campaign owner/DM | Co-DM | Player | Spectator |
|---|---:|---:|---:|---:|
| Read campaign metadata/members/context | Yes | Yes | Yes | Yes |
| First Hub account creation | Valid campaign invite only | Valid campaign invite only | Valid campaign invite only | Valid campaign invite only |
| Create campaign | Active `campaign:create` only | Active `campaign:create` only | Active `campaign:create` only | Active `campaign:create` only |
| Archive campaign | Owner only | No | No | No |
| Transfer campaign ownership | Owner only | No | No | No |
| Create invite | Yes | Yes | No | No |
| List/revoke invites | Yes | Yes | No | No |
| Change member role | Owner only | No | No | No |
| Remove member | Any non-owner | Player/spectator only | No | No |
| Leave campaign | Owner must transfer/archive first | Yes | Yes | Yes |
| Publish/activate legacy rules or brew | Yes | Yes | No | No |
| Browse/publish/rollback catalog policy when capability-enabled | Yes | Yes | Read bounded active summary only | Read bounded active summary only |
| Read full campaign character | Any campaign character | Any campaign character | Own only | Own only if one already exists |
| Read peer character profile | Yes, beside truth as `peerPreview` | Yes, beside truth as `peerPreview` | Yes | Yes |
| Read own sharing policy | Own character only | Own character only | Own character only | Own character only |
| Read another member's sharing policy | No | No | No | No |
| Target a character whose identity is hidden | Yes | Yes | Owner only | No |
| Change sharing policy | Own character only | Own character only | Own character only | Own character only |
| Create campaign character | Own character | Own character | Own character | No |
| Edit character under lease | Own character only | Own character only | Own character only | No while spectator |
| Clone/move character into campaign | Own character only | Own character only | Own character only | No |
| Archive character | Own character only | Own character only | Own character only | Own character only |
| Read/create private DM workspace | Own workspace | Own workspace | No | No |
| Read another DM's workspace | No | No | No | No |
| Log roll | Yes | Yes | Yes | No |
| Apply generic versioned character operation | Yes, immediate | Yes, immediate | No | No |
| Create source-derived peer proposal | Yes, proposed unless using direct authority | Yes, proposed unless using direct authority | Yes, proposed including self-target | No |
| Accept peer proposal | Target owner only | Target owner only | Target owner only; same account may later accept self-target | No |
| Reject peer proposal | Yes | Yes | Target owner only | No |
| Cancel peer proposal | Yes | Yes | Own proposal only | No |
| Grant XP or award one item batch to eligible campaign characters | Yes | Yes | No | No |
| Read party inventory | Yes | Yes | Yes | Yes |
| Move from party inventory | Yes | Yes | Request for own character only | No |
| Transfer from character | Own character | Own character | Own character | No |
| Resolve transfer to character | Override or target owner | Override or target owner | Target owner | No |
| Resolve transfer to party inventory | Yes | Yes | No | No |
| Approve player party-inventory request | Yes | Yes | No; may cancel own request | No |
| Read `all_members` event | Yes | Yes | Yes | Yes |
| Read `dm_only` event | Yes | Yes | No | No |
| Read `actor_and_dm` event | Yes | Yes | If actor | No |
| Read `explicit_accounts` event | Yes | Yes | If listed | If listed |

Account-level operator permissions are independent of campaign role:

| Operation | `platform:operate` + fresh reauthentication | Other account |
|---|---:|---:|
| List account entitlement summaries | Yes | Hidden 404 |
| Grant/revoke `campaign:create` | Yes | Hidden 404 |
| Grant/revoke `platform:operate` | Yes, except last-operator revoke | Hidden 404 |

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
- Rules-policy authorization is enforced on every server route. Hiding the capability-gated manager is not an
  authorization control; player/spectator management reads and writes fail without exposing policy details.
- Item awards can target only active characters whose owners remain active campaign members. A hidden peer
  identity does not prevent DM/co-DM targeting, but preview and events disclose no hidden carry or policy value.
- Spectator is an authenticated read-only campaign role in current mutation paths.
- DM/co-DM item transfers are explicit direct-authority commands. The Character Sheet and Campaign Overview
  submit one proposal command that atomically commits both containers; the UI says the move is immediate rather
  than presenting it as recipient consent.
- A player may request a party-inventory item only for a character they own. The request remains `proposed`,
  does not reserve or remove shared assets, and requires DM/co-DM approval. A stale approval fails with
  `TRANSFER_INSUFFICIENT` and leaves the request pending for decline/cancellation.
- A player transfer between two characters owned by the same account may resolve immediately because the
  source and destination authority are the same account. The server commits that proposal without an
  intermediate reservation. Peer and DM-owned destinations remain reserved until the target owner or a
  DM/co-DM resolves them.
- DM/co-DM role alone never approves somebody else's peer proposal. The DM instead issues a distinct direct
  operation with its own actor/command identity.
- Action and transfer resolution are both explicitly limited to active DM/co-DM/player memberships before
  their operation-specific owner/role checks.
- Account deletion-pending sessions may read session/deletion state, export, cancel deletion, or logout;
  ordinary campaign routes return `ACCOUNT_DELETION_PENDING`.
- Account deletion-pending sessions cannot use operator routes. The last active platform operator cannot request
  deletion. Purging a non-last operator is allowed and nulls retained entitlement-audit actor references.
