# Runbook: Oracle Cloud Always Free provisioning

> **Status:** In execution for Phase 6G; C-ALT adopted, no Hub data deployed yet
> **Severity:** Planned change, not an incident
> **Owner:** Campaign Hub maintainers
> **Last drill date:** never — update this line the first time the runbook is followed end to end
> **Estimated time:** 60–90 minutes, most of it waiting

## Purpose

Provision a single Oracle Cloud "Always Free" ARM virtual machine and run the portable Campaign Hub stack
on it at a public HTTPS address, at $0/month recurring cost.

This runbook produces a **staging** environment. Do not put a real campaign on it until the Phase 6G drills
and the Phase 6H game day in [private-v1-roadmap.md](../private-v1-roadmap.md) have passed.

---

## Confirmed values for this deployment

| Item | Value |
| --- | --- |
| Tenancy | **Existing account, reused.** Home region Israel Central (Jerusalem). |
| Public hostname | `campaignhub.duckdns.org` |
| Allowlisted operator | `github:63811646` (TrueMichato) |
| ACME / alert email | operator's address; set in `.env.hub`, not committed |
| Reused host | `VM.Standard.A1.Flex`, 1 OCPU / 6 GB, Ubuntu 22.04.4 ARM64, 100 GB boot volume |
| Free ARM pool | 2 OCPU / 12 GB total; 1 OCPU / 6 GB allocated to the reused host. Remaining quota has no available host capacity. |

Because the home region is Israel Central, **Parts A and the account warning below do not apply to this
deployment**. They are retained for future operators.

## STOP — read before creating any account

Oracle enforces **one Free Tier account per person**, using name, address, payment card, phone and device
fingerprint. This is not a soft limit:

- a duplicate signup is normally rejected outright, and **there is no appeal process**;
- Oracle's terms permit suspension of *all* of an offender's accounts, including the pre-existing one;
- deleting an old tenancy takes **30 days** to complete and **does not restore signup eligibility**.

Therefore: **do not create a second Oracle account while an existing one is open.** The downside case is
losing both the new account and whatever already runs on the old one.

### Decision gate

Check the existing tenancy first. In the OCI Console the home region is shown in the top-right region menu
marked `(Home)`, and under **Profile → Tenancy**.

| Existing home region | Action |
| --- | --- |
| Israel Central (Jerusalem) | Use the existing account. Ideal. |
| Any EU region | Use the existing account. ~60–80 ms to Israel; imperceptible here. |
| Any US or APAC region | Use the existing account. ~150–250 ms; playable, slightly laggy realtime. |
| South Korea North (Chuncheon) | Only region with **no** Always Free ARM. See below. |

Only if the home region is Chuncheon, or no usable account exists, is a fresh signup justified. In that
case close the old tenancy first (**Profile → Tenancy → Delete**), wait out the 30-day deletion, and accept
that re-signup may still be refused.

> **Latency is not the bottleneck.** Realtime here is small JSON events, not video. A 200 ms region costs
> about a fifth of a second before a teammate sees your HP change. Weigh that against the risk above.

---

## Prerequisites

- an SSH keypair (`ssh-keygen -t ed25519` if none exists) — the public key is uploaded, the private key never leaves your machine;
- a credit or debit card with credit function, only if signing up fresh (prepaid and virtual cards are refused);
- a GitHub account for the OAuth application;
- your GitHub numeric user ID, from `https://api.github.com/users/<your-login>` → the `id` field.

---

## Part A — Account (skip entirely if reusing an existing tenancy)

1. Go to <https://www.oracle.com/cloud/free/> → **Start for free**.
2. Country, name, email → verify the email link.
3. Address and phone → SMS verification.
4. **Home region — permanent and unchangeable.** Choose deliberately. Israel Central (Jerusalem) is
   recommended for an Israel-based group: lowest latency, keeps personal data under one legal regime, and
   as a smaller region it is far less contended for free ARM capacity than Frankfurt or Ashburn.
5. Card verification. Oracle places a temporary authorization hold and does not charge it. Signup does not
   convert to paid without explicit action.
6. Accept terms. You receive $300 of credits valid 30 days **plus** the Always Free allowances, which do not
   expire. This runbook uses only Always Free resources; the trial credits are irrelevant here.

> After the 30-day trial ends the account downgrades automatically to Always Free. Resources that fit
> inside the free allowances keep running. Do not upgrade to Pay As You Go unless you decide to.

---

## Part B — Reclaim quota

Always Free is a **tenancy-wide pool**: 2 OCPU / 12 GB RAM for Ampere A1, and **200 GB of block storage in
total** shared by every boot and block volume. The minimum boot volume is 47 GB regardless of shape.

Check **Compute → Instances**, **Block Storage → Boot Volumes**, and **Governance → Limits, Quotas and
Usage** (resource `standard-a1-core-count`, with the region selector set to the home region — the page
renders empty if a non-home region is selected, which is not an error).

For a new instance this runbook chooses **1 OCPU / 6 GB and a 100 GB boot volume**. The repurposed Foundry
instance already has those resources; see C-ALT.1 and C-ALT.2.

> **This deployment:** the retired wiki instance was terminated, but 317 replacement launches still failed
> for lack of host capacity. The remaining Foundry instance uses 1 OCPU / 6 GB and a 100 GB boot volume; it
> is now the adopted Hub host under Part C-ALT. The unused 1 OCPU / 6 GB is quota headroom, not reserved
> physical capacity.

If an instance must be removed:

1. confirm its data is genuinely migrated, and that you are terminating the *correct* instance — compare
   the OCID, not just the display name;
2. **Block Storage → Boot Volumes → Create Manual Backup** — termination is otherwise irreversible;
3. terminate the instance, ticking *delete the attached boot volume*;
4. re-check **Compute → Instances** to confirm the cores were returned before continuing.

> Free capacity is a **quota, not a reservation**. Releasing a core does not guarantee you can immediately
> claim one — Part C's capacity guidance may still apply. Do not terminate the wiki until you are ready to
> create the replacement in the same session.

> **Order matters, and getting it wrong costs money.** The free allowance is consumed by what exists *at the
> moment an instance is created*. Creating the hub while the pool is still fully allocated produces a third
> instance that sits entirely outside Always Free and is billed at list price — roughly €10/month — even
> though every individual setting looks correct. Release the core first, confirm it in **Compute →
> Instances**, then create. See C6.

---

## Part C-ALT — Repurpose an existing instance (when capacity never comes)

> **Use this path instead of Part C if you already own a running A1 instance you no longer need.**
> After 317 consecutive failed launches over 24 hours in `il-jerusalem-1` (2026-08-27/28), this became the
> adopted path for this deployment. It is not a workaround; it is strictly safer than launching new.

### Why this works

Oracle checks host capacity when an instance **launches or starts** — never while it is running. A running
instance already holds its slot on a physical host. So converting a machine you already have completely
sidesteps the capacity lottery, whereas creating a new one re-enters it every time.

### The one rule

> **Never stop the instance.** Stopping releases the host allocation back to the pool, and starting again is
> a fresh capacity request. With the pool exhausted, a stop is effectively irreversible — you would lose the
> instance you were trying to reuse. `Reboot` is safe and preserves the host; `Stop` is not. Treat them as
> completely different operations, because in this region they are.

The same rule applies inside Ubuntu: `shutdown -h`, `poweroff`, `halt`, and `systemctl poweroff` produce the
forbidden stopped state. Use only `sudo reboot`, OCI **Reboot**, or OCI **Reset** when explicitly instructed.

This single rule determines everything below. Each candidate change is judged on whether it requires a stop.

| Change | Requires stop? | Verdict |
| --- | --- | --- |
| Reinstall software, change ports, redeploy | No | Safe — this is the whole job |
| `reboot` | No (host preserved) | Safe |
| Upgrade packages within Ubuntu 22.04 | No (reboot only if requested) | **Do now** — see C-ALT.3 |
| Upgrade the OS release in place | No stop, but multiple reboots and no usable rollback | **Defer**, see C-ALT.3 |
| Expand the boot volume | No (online resize) | Safe, but **not needed** |
| Change OCPU/memory (resize shape) | Forces a reboot **and** re-checks host capacity | **Do not do this** |
| Detach/attach a boot volume | Yes | Never — this is the trap to avoid |

### C-ALT.0 — Audit what the Foundry guide may have configured

This instance was built following the
[Foundry VTT Always Free Oracle guide](https://foundryvtt.wiki/en/setup/hosting/always-free-oracle). That
describes intended setup, not the current machine. Steps may have been skipped, changed, or removed since the
original installation. Verify each item before treating it as complete.

**Likely present — verify rather than repeat blindly:**

| Foundry guide step | How to verify | Effect if present |
| --- | --- | --- |
| `iptables` rule for 80, 443 and 30000 | `sudo iptables -L INPUT --line-numbers -n` | D2 is partly complete |
| VCN ingress for 80 TCP, 443 TCP/UDP and 30000 TCP | Open the instance's subnet security list in OCI | D1 is partly complete |
| Budget alert at 1% forecast | **Billing & Cost Management → Budgets** | C6 may already be complete |
| Boot-volume backup policy | Open the boot volume's **Backup Policies** tab | Scheduled backups may already exist |

**Potential conflicts — check them rather than assuming they exist:**

1. **An old host-level Caddy would conflict if it owned ports 80 or 443.**
   This stack runs its own Caddy inside Docker, bound to those ports. Check before changing anything:

```bash
sudo systemctl status caddy --no-pager 2>/dev/null || true
sudo ss -tlnp | grep -E ':(80|443)\b'
```

   For this reused VM, the live check on 2026-08-30 showed only Foundry on port 30000; ports 80 and 443 were
   free. If that is still true, **do nothing** here. If the second command now shows `caddy` owning either
   port, disable only that old service and check again:

```bash
sudo systemctl disable --now caddy
sudo ss -tlnp | grep -E ':(80|443)\b'   # expect no output
```

   Do not reuse a host-level Caddy without deliberately redesigning the deployment. The documented stack
   keeps its Caddyfile, certificate state, and internal service names inside the container; retaining the host
   service would create an undocumented second deployment model.

2. **Port 30000 is open in both firewalls and must be closed.**
   That is Foundry's application port. Nothing in this stack listens on it, and leaving it open is an
   unnecessary exposure once Foundry is gone.

   First list the rules with line numbers. If the exact Foundry multiport rule exists at line `<N>`, confirm
   that line is the one about to be replaced, then replace it in place rather than deleting and reinserting
   at a guessed position:

```bash
  sudo iptables -L INPUT --line-numbers -n
   sudo iptables -R INPUT <N> -m state --state NEW -p tcp \
     --match multiport --dports 80,443 -j ACCEPT
```

   If the exact rule is not present, do not improvise; follow D2 from the machine's current ruleset. Remove
   `30000` from the OCI ingress rule separately. Keep the current SSH session open, verify a second new SSH
   session works, and only then run `sudo netfilter-persistent save`.

**Deliberate divergence — leave it as it is:**

The Foundry guide creates its security-list ingress rules as **stateless**; this runbook's D1 specifies
**stateful**. Stateless rules require the return traffic to be permitted by a matching egress rule, which
the VCN wizard sets up. Since that configuration is already working for Foundry over exactly the ports this
stack needs, **do not convert it.** Rewriting working firewall rules from a remote SSH session is a good way
to lock yourself out of a machine you cannot stop and recover. Note the divergence in the evidence section
and move on.

The guide proposes VCN CIDR `10.0.0.0/24`, but verify the VCN actually attached to this instance. The stack's
Docker bridge is `172.30.0.0/24`; if the real VCN overlaps that range, change the Docker network before
deploying. `HUB_TRUST_PROXY` is based on the internal Caddy hop, not the VCN name.

**Finally — check whether a domain already points here.** The Foundry guide has you create a DuckDNS or
similar domain aimed at this instance's IP. If that domain still resolves to it, decide deliberately whether
to retire it or keep it. This runbook uses the separate `campaignhub.duckdns.org` name. Two names resolving
to the same host is harmless; only names present in an active Caddy configuration are considered for
certificates.

### C-ALT.1 — Do not resize. You are already at the target spec

The Foundry instance is `VM.Standard.A1.Flex`, 1 OCPU / 6 GB. That is *exactly* what this runbook specifies
in C1. There is nothing to gain from resizing, and resizing forces a reboot during which the host must have
room for the larger shape — a capacity check you have already lost 317 times.

A clarification on the allowance, since it is easy to misread: the tenancy limit is 2 OCPU / 12 GB in total,
and this instance consumes 1 OCPU / 6 GB of it. The remaining 1 OCPU / 6 GB is unallocated headroom, not a
second free machine you are entitled to on demand — claiming it still requires a successful launch.

### C-ALT.2 — Do not expand the boot volume. It is already 100 GB

The live SSH banner on 2026-08-29 reported `/` as **11.3% of 96.73 GB**: roughly 11 GB used and 86 GB free.
That is more headroom than the stack needs. Record the live values rather than relying on the banner alone:

```bash
findmnt -no SOURCE,FSTYPE,SIZE,AVAIL /
df -h /
lsblk
```

If it ever does need to grow, OCI supports **online** boot-volume resize — no stop:

```bash
# after enlarging the volume in OCI, first identify the real root disk/partition with lsblk
# then use OCI's documented rescan/grow procedure for that device; do not assume /dev/sda1
```

### C-ALT.3 — OS decision: patch current 22.04; defer the 24.04 release upgrade

> **Decision for this instance:** do **not** run `do-release-upgrade` while free ARM capacity is exhausted.
> Fully patch the existing Ubuntu 22.04 installation now, enable the free personal Ubuntu Pro `esm-apps`
> service, reboot, and verify it. Install current Docker CE from Docker's supported Jammy repository in
> Part E.

This is the cautious answer even though an in-place release upgrade is officially supported:

- **There is no usable rollback.** A boot-volume backup taken while the VM runs is crash-consistent. Restoring
  it creates another volume; using that volume requires either a new instance (no capacity) or stopping and
  reconfiguring this one (which may never start again).
- **The serial console is not a complete rollback mechanism.** It remains reachable when guest networking or
  SSH fails, but it cannot guarantee repair of a broken bootloader, initramfs, filesystem, or interrupted
  package transaction.
- **The existing OS is already viable.** The live SSH banner identifies Ubuntu 22.04.4, Oracle's ARM64
  kernel `6.8.0-1041-oracle`, a 100 GB root volume, and a pending reboot. Docker officially supports Jammy.
- **There is no need to take risk tonight.** Ubuntu 22.04 standard maintenance continues until May 2027.
  Ubuntu Pro is free for personal use on up to five machines and `esm-apps` supplies the seven additional
  application security updates currently advertised by the host.

Revisit 22.04 → 24.04 before May 2027, but only after replacement/helper capacity exists, or after explicitly
accepting that the host may become unavailable. Prefer rebuilding directly on a fresh Ubuntu 24.04 instance.

#### Arm and test the serial console anyway

The console is still valuable for ordinary kernel, firewall, SSH, and network failures. A console connection
authenticates you to Oracle's console service; it does **not** authenticate you to Ubuntu. Official Ubuntu
cloud images lock the `ubuntu` account password, so create a dedicated local recovery account rather than
changing the normal SSH account:

```bash
sudo adduser ocirescue
sudo usermod -aG sudo ocirescue
sudo /usr/sbin/sshd -T | grep -i '^passwordauthentication'
```

Choose a long recovery password and store it in your password manager. The SSH setting should remain `no`;
the password is for the local serial console, not internet login.

1. Open **Compute → Instances → your instance → Resources → Console connections → Create console connection**.
2. Either paste an RSA public key whose private half you already hold, or let OCI generate and download a
   temporary RSA key pair. The console key is separate from the Ubuntu account's SSH key.
3. Move a downloaded private key out of `Downloads` and restrict it:

```bash
  mkdir -p ~/.ssh
   mv ~/Downloads/<downloaded-key>.key ~/.ssh/oci-console.key
   chmod 600 ~/.ssh/oci-console.key
```

4. In the connection row, choose **⋮ → Copy serial console connection for Linux/Mac**. Oracle's generated
   command may omit `-i`; add `-i ~/.ssh/oci-console.key` to both the outer `ssh` command and its inner
   `ProxyCommand`.
5. Try that command first. Do **not** weaken SSH algorithms pre-emptively. Only if the error explicitly says
   `no matching host key type` or `no mutual signature algorithm`, add the requested compatibility option
   (`HostKeyAlgorithms=+ssh-rsa` or `PubkeyAcceptedAlgorithms=+ssh-rsa`) to the affected command.
6. Press Enter to wake a blank console, log in as `ocirescue`, and run `sudo true`. Exit SSH with `~.`.

Seeing the OCI connection open is not enough; the local login and `sudo` command are the actual test.
Console connections are temporary troubleshooting sessions, not permanent access. Preserve the recovery
password and an RSA console key outside the VM, and expect to recreate the OCI connection on demand. Delete
the test connection when the drill is over.

On an official OCI Ubuntu image, do not rewrite GRUB or serial settings if the console already displays boot
output and a login prompt. Oracle's manual `ttyAMA0` setup guidance is for imported images. If output or input
is missing, inspect before changing anything:

```bash
test -c /dev/ttyAMA0 && echo "ARM serial device exists"
grep -o 'console=[^ ]*' /proc/cmdline
systemctl status serial-getty@ttyAMA0.service --no-pager
```

For ARM, the first serial device is `ttyAMA0`, not the x86 `ttyS0`. If boot output exists but no login prompt
appears, enable only the missing getty:

```bash
sudo systemctl enable --now serial-getty@ttyAMA0.service
```

Do not add `GRUB_TERMINAL`, `GRUB_SERIAL_COMMAND`, or guessed kernel parameters unless the image actually lacks
serial output and the change has been separately reviewed. A malformed GRUB change is more dangerous than
the condition it is meant to prevent.

#### Take backups, but understand their limit

Verify whether the Foundry guide's automatic boot-volume policy actually exists; the guide is not evidence
that the step completed. Before a manual backup, stop Foundry and host Caddy, flush writes, and then create a
**Full** boot-volume backup:

```bash
sudo systemctl stop foundry caddy 2>/dev/null || true
sync
```

In OCI: **Storage → Block Storage → Boot Volumes → your volume → Create Backup → Full**. Always Free includes
up to five volume backups, but verify current usage before creating one. This backup protects the data for a
future restore; it does not provide same-day rollback while capacity is unavailable.

Copy irreplaceable Foundry data and the configuration inventory to storage outside this VM as well. A backup
that exists only on the boot volume does not survive losing the host.

#### Adopted path — fully patch and verify Ubuntu 22.04

Run these commands in the normal SSH session to the instance, not on the Mac:

```bash
cat /etc/os-release
uname -m && uname -r
sudo dpkg --audit
sudo dpkg --configure -a
sudo tail -n 100 /var/log/unattended-upgrades/unattended-upgrades.log

sudo apt update
sudo apt install ubuntu-advantage-tools
pro status
```

`sudo pro attach` prints a URL and one-time code. Complete that browser flow with the free personal Ubuntu Pro
subscription **only if `pro status` says the machine is not attached**. Do not paste the subscription token
into this repository or chat. Do not continue until `pro status` confirms attachment.

Then enable the additional application security repository, refresh APT again, and apply everything:

```bash
sudo pro enable esm-apps
pro status
sudo apt update

cat /var/run/reboot-required.pkgs 2>/dev/null || true
```

Run `full-upgrade` interactively, not with `-y`. If `dpkg` asks about the OCI-installed versions of
`sshd_config`, GRUB, Netplan, or `netfilter-persistent`, keep the installed version and inspect the new
`.dpkg-dist` file later.

The current banner says a restart is required. Use **only** a reboot:

```bash
sudo reboot
```

Never use `shutdown -h`, `poweroff`, `halt`, or `systemctl poweroff`; in OCI these stop the VM and release its
host allocation just like the Console's **Stop** button.

Reconnect and verify that the machine is healthy before continuing:

```bash
cat /etc/os-release              # still Ubuntu 22.04
uname -m && uname -r             # aarch64; Oracle kernel
systemctl --failed
ip -br address
ip route
sudo netplan --debug generate
sudo /usr/sbin/sshd -t
sudo /usr/sbin/sshd -T | grep -iE '^(passwordauthentication|permitrootlogin)'
pro status
```

`passwordauthentication` should be `no`, and `permitrootlogin` should not permit password login. Open a
**second new SSH session** before closing the first. Then continue to C-ALT.4 and, later, Part E.

#### Future release upgrade checklist — do not execute under current capacity conditions

When a real rollback path exists, follow Canonical's OCI-specific 22.04 → 24.04 guide. Before the hop:

```bash
sudo dpkg --configure -a
sudo dpkg --audit
apt-mark showhold
df -h / /boot /boot/efi
df -i / /boot /boot/efi
systemctl --failed
sudo netplan --debug generate
sudo /usr/sbin/sshd -t

ip -br address
ip route
sudo iptables-save > ~/iptables-v4.preupgrade
sudo ip6tables-save > ~/iptables-v6.preupgrade
sudo cp -a /etc/netplan /etc/ssh /etc/default/grub /etc/default/grub.d /root/
dpkg-query -W > ~/packages.preupgrade
```

Copy those records off the VM. Fully patch and reboot first, then stop the Oracle agents immediately before
the release upgrader:

```bash
sudo snap stop oracle-cloud-agent
sudo systemctl stop unified-monitoring-agent
tmux new -s release-upgrade
sudo do-release-upgrade
```

`tmux` is a terminal session that lives on the server. If SSH drops, the upgrade continues; reconnect and
run `tmux attach -t release-upgrade`. Do not use `-d` to force a development release.

Use Canonical's prompt guidance:

| Prompt | Cautious answer |
| --- | --- |
| Temporary SSH daemon on port 1022 | Continue, but do not expose 1022 publicly when the tested serial console is available |
| Save current IPv4/IPv6 rules | **Yes** when deliberate custom rules exist; otherwise follow Canonical's default |
| `/etc/default/netfilter-persistent` | **N — keep the installed OCI version** |
| `/etc/ssh/sshd_config` | Keep the installed OCI version; inspect the `.dpkg-dist` file later |
| `/etc/default/grub` | Keep the installed OCI version and inspect differences later |
| Restart services automatically | Yes |
| Remove obsolete packages | **No initially**; remove only after boot, network, SSH, console, and applications are verified |
| Restart to finish | Yes |

If networking is lost, do not assume Netplan is the cause and do not run `apt install` before networking
works. The often-cited A1 report showed an empty iptables ruleset with `INPUT DROP`, not a demonstrated ARM
driver or Netplan defect. Diagnose first:

```bash
ip -br link
ip route
sudo iptables -S
sudo iptables-save
sudo netplan --debug generate
sudo journalctl -b -u systemd-networkd -u cloud-init-local -u cloud-init --no-pager
```

If the exact condition is an empty INPUT chain with policy DROP, temporarily run
`sudo iptables -P INPUT ACCEPT`; do not blindly flush OCI or Docker tables. If Netplan validates, use
`sudo netplan apply`. Reinstalling `netplan.io` requires working networking or a matching cached package, so
it is not an offline first-aid command.

### C-ALT.4 — Remove the Foundry software

First identify exactly what owns the Foundry listener. Do not kill the reported PID directly: if systemd or
another supervisor owns it, the process may immediately restart with a new PID.

```bash
sudo ss -tlnp | grep -E ':(80|443|30000)\b'
# Substitute the Node PID reported on port 30000:
sudo systemctl status <PID> --no-pager
ps -o pid,ppid,user,lstart,cmd -p <PID>
sudo sh -c "tr '\0' ' ' </proc/<PID>/cmdline; echo"
cat /proc/<PID>/cgroup
```

If `systemctl status <PID>` names a unit—for the referenced Foundry guide it is commonly
`foundryvtt.service`—disable that exact unit:

```bash
sudo systemctl disable --now foundryvtt.service   # replace only if status showed another unit
sudo systemctl is-enabled foundryvtt.service      # expect: disabled
sudo systemctl is-active foundryvtt.service       # expect: inactive
```

If no unit is named, stop here and identify the supervisor from the parent PID/cgroup output (for example,
PM2, a user service, Docker, or a login shell). Disable the supervisor's persistent entry rather than killing
Node. Do not proceed until its restart mechanism is understood.

**This deployment's observed case:** PID 1016 belongs to `pm2-ubuntu.service`; PM2 manages one application
named `foundry` and resurrects it from `/home/ubuntu/.pm2` at boot. `pm2 describe foundry` confirmed:

- application/runtime files: `/home/ubuntu/foundry`;
- persistent Foundry worlds, configuration and uploads: `/home/ubuntu/foundryuserdata`;
- logs: `/home/ubuntu/.pm2/logs/foundry-{out,error}.log`.

Do not delete `foundryuserdata` merely because the runtime is retired. Copy it off-VM first, or deliberately
record that it is no longer needed. Removing the PM2 process does not delete any of these files.

Remove Foundry from PM2's saved process list, and then disable the systemd unit:

```bash
pm2 list
pm2 describe foundry
sudo sh -c "tr '\0' ' ' </proc/$(pgrep -f '/home/ubuntu/foundry/resources/app/main.js' | head -1)/cmdline; echo"

pm2 delete foundry
pm2 save --force
sudo systemctl disable --now pm2-ubuntu.service

systemctl is-enabled pm2-ubuntu.service  # expect: disabled
systemctl is-active pm2-ubuntu.service   # expect: inactive
```

Run the `pm2` commands as `ubuntu`, not with `sudo`; the process store is `/home/ubuntu/.pm2`. Do not run
another `pm2` command after disabling the service, because the CLI may start a new per-user PM2 daemon.
Leaving the disabled service and PM2 package installed temporarily is harmless; remove them only after the
Hub survives a reboot.

Ports 80 and 443 being absent from the first `ss` output means no current listener, but Caddy might still be
enabled and return after reboot. Disable it if installed:

```bash
if systemctl list-unit-files caddy.service --no-legend 2>/dev/null | grep -q caddy; then
  sudo systemctl disable --now caddy.service
fi
sudo ss -tlnp | grep -E ':(80|443|30000)\b' || echo "Ports 80, 443 and 30000 are free"
```

Only after all three ports are free should you reclaim disk. Foundry's application and user-data directories
are commonly under `/home/ubuntu/foundry*` or `/srv/foundry*`; list them before deleting so you keep any world
data you still care about:

```bash
sudo du -sh /home/ubuntu/* /srv/* /opt/* 2>/dev/null | sort -h | tail -30
```

Leave the OS, SSH configuration, users, `iptables` rules for 80/443, and the Node.js install alone. Node is
harmless, and re-editing firewall rules over SSH on a machine you cannot stop is a needless risk.

### C-ALT.5 — What happens next (C-ALT path)

> **Skip C8 completely. Keep public IP `129.159.151.68`.**
>
> A live OCI query on 2026-08-30 confirmed that this is an **ephemeral** public IP. In OCI, “ephemeral” does
> not mean “changes on reboot”: Oracle documents that it remains assigned across both reboot and stop/start.
> It is deleted only if explicitly unassigned, if its private IP/VNIC is deleted or detached, or if the
> instance is terminated. Foundry's years of successful access through this address are consistent with
> that behavior.
>
> C8 was written for the abandoned new-instance plan and contained an incorrect claim about stop/start.
> Swapping this working address for a reserved one would deliberately drop SSH and break existing DuckDNS
> records until they were changed, without helping the current deployment.

Do not infer the active subnet from its name. In OCI, open **Instance → Attached VNICs → Primary VNIC** and
record the linked subnet. Then open that subnet's VNIC attachments and verify what else uses it:

- if this is the only VNIC, D1 Option 1 (the subnet security list) is acceptable;
- if any other VNIC uses it, use the D1 NSG option so 80/443 are scoped to this instance.

Only mark R-17 not applicable after recording that evidence.

Optionally rename the instance to `CampaignHub` (**Instance → Edit → display name**) — cosmetic only, no
reboot, no risk.

Open **Instance → Edit** and verify **Restore instance lifecycle state after infrastructure maintenance** is
enabled. Review the instance's maintenance and work-request panels for any scheduled event. This cannot
prevent every Oracle-side interruption, but it avoids leaving the VM stopped after supported maintenance.

Continue in this order:

1. Read **C9** so the idle-reclamation risk is understood; there is no immediate command to run.
2. In **D1**, inspect the existing Foundry VCN rules instead of creating another subnet. Keep/open TCP 80 and
   443; remove TCP 30000 after Foundry is stopped. Use an NSG only if another VNIC shares the subnet.
3. In **D2**, inspect the existing host `iptables` rules. Keep the 80/443 ACCEPT rule and remove 30000. Do not
   add duplicates.
4. Follow **Part E** to install Docker once from its supported Jammy repository.
5. In **Part F**, point `campaignhub.duckdns.org` at `129.159.151.68`. As of 2026-08-30 it resolves to
   `46.121.39.154`, so it is not ready for certificate issuance. Rotate the previously exposed DuckDNS token
   before making this change.

Skip Part B, all of Part C (including C8), and the new-instance-only note in D1.

---

## Part C — Create the virtual machine (new instance)

**Compute → Instances → Create instance.**

The wizard has four numbered sections and several collapsed **Advanced options** panels. Only a handful of
fields matter; the rest are safe at their defaults. Both are listed below, because a field left at its
default *deliberately* is not the same as a field you missed.

### C1 — Image and shape

| Field | Value | Why |
| --- | --- | --- |
| Name | `campaignhub` |  |
| Image | **Canonical Ubuntu 24.04** | LTS; the `aarch64` build is selected automatically once the shape is ARM. |
| Instance type | **Virtual machine** |  |
| Shape series | **Ampere** |  |
| Shape | **VM.Standard.A1.Flex** | The free ARM shape. |
| OCPUs / memory | **1 OCPU / 6 GB** | Ample here, and materially likelier to get capacity than 2/12. Can be raised later without rebuilding. |

> **Trap:** the fourth shape-series tile, *Specialty and previous generation*, lists "Always Free" in its
> description. It is the wrong tile — that is the older `VM.Standard.E2.1.Micro` AMD shape. The free ARM
> shape lives under **Ampere**. Ignore the "Don't see the shape you want? Upgrade" banner as well; it is an
> advertisement, not a prerequisite.

### C2 — Capacity type (Advanced options, easy to miss)

| Field | Value | Why |
| --- | --- | --- |
| Capacity type | **On-demand capacity** |  |
| Cluster placement group | off |  |
| Fault domain | **leave blank** |  |

Two of these are load-bearing:

- **Never choose Preemptible capacity.** Preemptible instances can be reclaimed by Oracle at any time with
  roughly 30 seconds' notice, and they are a paid capacity type rather than an Always Free one. It is
  offered right next to the correct option and sounds harmless.
- **Leave Fault domain unset.** Pinning one restricts placement to a single rack group and makes "out of
  host capacity" markedly more likely. Letting Oracle choose is both easier and more available.

### C3 — Networking

| Field | Value |
| --- | --- |
| Primary network | an existing VCN with a **public** subnet, or let the wizard create one |
| Subnet | the **public** subnet |
| Private IPv4 | **Automatically assign** |
| Public IPv4 | **Automatically assign — on** |
| IPv6 | off (the DuckDNS record is IPv4; the wizard will warn the VCN has no IPv6 prefix, which is expected) |
| Network security groups | off, unless you follow the NSG note in Part D1 |
| DNS record | leave at *Assign a private DNS record*; the blank hostname and `<hostname>.undefined` FQDN preview are cosmetic and affect only internal VCN DNS, which this stack does not use |
| Launch options | leave at *Let Oracle Cloud Infrastructure choose* |

> **If you reuse an existing VCN and subnet** — for example the one an earlier instance created — be aware
> that its **security list is shared by every instance in that subnet**. The ingress rules added in Part D1
> will therefore open ports 80 and 443 for the neighbours too. See Part D1 for how to scope the rules to
> this instance alone.

Confirm the subnet is genuinely public before continuing: it must have an **Internet Gateway** and a route
rule sending `0.0.0.0/0` to it. A "public" subnet without that route yields an instance with a public IP
that nothing can reach.

### C4 — Storage

| Field | Value | Why |
| --- | --- | --- |
| Specify a custom boot volume size | **turn this toggle on** | It is **off** by default, which silently accepts the 46.6 GB minimum. |
| Boot volume size | **100 GB** | Headroom for container images, the 5etools data set, build cache, and local backup staging. |
| Boot volume performance | **Balanced (VPU 10)**, the default | Higher VPU is not billed separately — only storage *volume* counts against the free allowance — but Balanced is more than enough here. |
| In-transit encryption | leave **on** |  |
| Encrypt with a key you manage | leave **off** | Customer-managed keys need a Vault; Oracle-managed encryption is already on. |
| Block volumes | none |  |

Always Free includes **200 GB of block storage in total**, shared across every boot and block volume in the
tenancy, and the minimum boot volume is 47 GB. Do the arithmetic before choosing a size: with one other
47 GB instance remaining, a 100 GB boot volume brings the tenancy to 147 GB and stays inside the allowance.
Exceeding 200 GB is billable.

### C5 — Options that are safe to leave alone

Screens that look consequential but are not, for this deployment:

| Setting | Leave at | Note |
| --- | --- | --- |
| Instance metadata service — require authorization header | **on** (default) | Forces IMDSv2. Ubuntu 24.04 supports it. Turning it off would weaken metadata security for no gain. |
| Initialization script (cloud-init) | **empty** | Part E performs OS preparation over SSH instead, so failures are visible rather than buried in boot logs. |
| Live migration | *Let Oracle choose* |  |
| Restore instance lifecycle state after maintenance | **on** | Leave it on: it restarts the instance automatically after Oracle host maintenance instead of leaving it stopped. |
| Oracle Cloud Agent plugins | defaults | *Compute Instance Monitoring* provides the free CPU/memory/network metrics referenced in Part C9. |
| Shielded instance | **off** | Not supported on A1 shapes, and once enabled only the instance name can be changed afterwards. |
| Confidential computing | **off** |  |
| Security attributes (ZPR) | none |  |
| SSH keys | paste `~/.ssh/id_ed25519.pub` | The only way in; there is no console password. |

Create, and wait for **Running**.

### C6 — Confirm you will not be billed (before clicking Create)

The wizard's **Estimated cost** panel shows something like €10.00/month even for a fully Always Free
configuration. This is expected: it is a generic list-price calculator that does not subtract free-tier
allowances. It is **not** confirmation that you will be charged — but it is also not proof that you won't.

The authoritative in-console signal is the **"Always Free eligible"** badge shown against the shape and the
boot volume. If it is present, the resource is within the allowance. If it is absent, the estimate is real.

Three ways this configuration can become genuinely billable:

1. **The CPU pool is already spent.** Always Free covers 2 OCPU of Ampere A1 *tenancy-wide*. If existing
   instances already use all of it, the new instance is entirely outside the allowance and is billed at list
   price. **This is the most likely cause of a surprising estimate** — and it is an ordering problem, not a
   configuration one. Complete Part B first: the core must be released *before* this instance is created,
   not afterwards.
2. **Total block storage exceeds 200 GB.** This is a cliff, not a slope: go over and the *entire* volume is
   billed, not merely the excess. Sum every boot and block volume in the tenancy — including any orphaned
   boot volume left behind by an instance terminated without ticking *delete the attached boot volume*.
3. **The shape is not A1.** AMD and Intel flexible shapes are never free at any size.

Set a budget alert before creating anything, so a mistake surfaces in days rather than at month end:

**Billing & Cost Management → Budgets → Create Budget**, scope the root compartment, set the monthly amount
to a token value such as €1, and add an alert rule at 100% of *actual* spend to your email address.

After the instance is running, confirm reality rather than the estimate under
**Billing & Cost Management → Cost Analysis**. Charges should be zero.

### C7 — If you hit "Out of host capacity"

This is the single most common failure and it is **not** an error in your configuration — free ARM hosts are
heavily oversubscribed and Oracle documents this as expected behaviour. The console gives you no queue and no
notification; the only mechanism is to ask again.

Two mitigations that appear in most online guides **do not apply to this tenancy**:

| Common advice | Why it does not help here |
| --- | --- |
| "Try another Availability Domain" | Israel Central (`il-jerusalem-1`) has exactly **one** AD. There is nothing to rotate to. |
| "Try another region" | Always Free resources exist only in your **home** region, which is permanent. |

So the levers actually available to you, in order of effort:

1. **Confirm this is really capacity, not quota.** If the wiki instance has not been terminated yet, your
   2 OCPU / 12 GB allowance is already fully allocated, and the failure may be a limit dressed up as a
   capacity message. Finish Part B first. The retry script below distinguishes the two and refuses to loop
   on a quota error.
2. **Ask for 1 OCPU / 6 GB, not 2 / 12.** Materially better odds, and it is what this stack needs anyway.
3. **Never pin a Fault Domain.** Leaving it unset lets Oracle place you on any host with room.
4. **Retry off-peak** for the region — early morning local time is generally better than evening.
5. **Run the retry script** below instead of clicking Create by hand.
6. **Consider Pay As You Go** — see the honest trade-off after the script.

#### Retrying automatically

Community tools exist for this (`oci-arm-catcher` and similar). **Do not use them.** They require an OCI API
key, and an OCI API key grants full control of your tenancy — every instance, every volume, every bucket.
That is an unjustified supply-chain risk for a retry loop. This repository ships an equivalent you can read
end to end:

```bash
deploy/hub/oci-retry-launch.sh
```

It uses only the official `oci` CLI and your own local CLI profile, retries politely on capacity errors, and
**stops immediately** on any error that retrying cannot fix — exhausted quota, bad credentials, or an invalid
request — rather than hammering the API.

Install the CLI and authenticate once:

```bash
# macOS
brew install oci-cli

# then, interactively — choose your Israel Central region and let it generate an API key
oci setup config
```

`oci setup config` prints a public key at the end. Upload it in the console under your **Profile → My
profile → API keys → Add API key → Paste public key**, or the CLI will not authenticate.

Then just run it:

```bash
./deploy/hub/oci-retry-launch.sh
```

There is nothing to export. The script reads your compartment from the `tenancy` entry in `~/.oci/config`,
finds the subnet automatically when the compartment has only one (and lists them for you to choose if there
are several), and picks up an SSH public key from `~/.campaignhub.pub`, `~/.ssh/id_ed25519.pub`, or
`~/.ssh/id_rsa.pub` — offering to generate a dedicated key if you have none. A key used only for this host
is preferable to reusing a general-purpose one, because it can be revoked without affecting anything else.

Override any of it if you need to:

```bash
OCI_SUBNET_ID=ocid1.subnet.oc1.il-jerusalem-1.xxxx ./deploy/hub/oci-retry-launch.sh
```

Defaults match the rest of this runbook: `VM.Standard.A1.Flex`, 1 OCPU, 6 GB, 100 GB boot volume, named
`CampaignHub`, retrying every 3 minutes forever until you stop it with Ctrl-C. Override with `OCPUS`,
`MEMORY_GB`, `BOOT_GB`, `DISPLAY_NAME`, `INTERVAL_SECONDS`, or `MAX_ATTEMPTS`.

Do not lower `INTERVAL_SECONDS` much below 180. Oracle rate-limits the API, and a tight loop earns `429`
responses that make you *less* likely to get a host, not more.

Leave it running in a terminal. On success it prints the instance OCID and stops; resume at **C8**.

#### Pay As You Go — the honest trade-off

Upgrading the account is the highest-leverage option, and it solves **two** recorded problems at once:
capacity priority, and the idle-reclamation risk in **C9** (R-16), from which PAYG accounts are exempt.

What it does and does not do:

|  | Free Tier | Pay As You Go |
| --- | --- | --- |
| Always Free allowance | 2 OCPU / 12 GB ARM, 200 GB storage | **identical** — upgrading does not raise it |
| Host capacity priority | lowest | higher; "out of host capacity" is markedly less common |
| Idle reclamation after 7 days | applies | **exempt** |
| If you exceed the allowance | instances may be **terminated** | you are **billed** |

That last row is the whole decision. On Free Tier, overrunning the limit can destroy your data; on PAYG it
quietly costs money. Neither is automatically safer — they fail in opposite directions.

If you upgrade, do it deliberately: set the **€1 budget alert from C6 first**, keep the instance at
1 OCPU / 6 GB, and keep total block storage under 200 GB. Within those bounds the bill stays at zero. An
upgrade also requires a payment method on file, and Oracle may place a small temporary authorisation on the
card, which is refunded.

### C8 — Public-IP choice (new-instance path only)

**C-ALT operators skip this section.**

An OCI ephemeral public IP remains assigned across reboot and stop/start. Its lifetime is tied to the private
IP/VNIC; it is deleted only when explicitly unassigned, when that private IP or VNIC is deleted/detached, or
when the instance is terminated. It is therefore stable enough for normal operation and DuckDNS.

A reserved IP is optional. Its benefit is portability: it survives instance termination and can later be
assigned to a replacement, avoiding a DNS change. It does **not** make reboot or stop/start safer.

For a newly created instance, either:

- keep the assigned ephemeral IP and record it for Part F; or
- deliberately swap to a reserved IP if replacement portability is worth the brief outage and DNS change.

Never perform that swap merely because the word “ephemeral” sounds temporary. Unassigning the existing
address destroys it immediately and drops every SSH connection.

### C9 — Keep the instance from being reclaimed as idle

Oracle reclaims Always Free compute instances that look unused. An instance is deemed idle when, across a
**7-day window, all three** of the following hold:

- 95th-percentile CPU utilisation below 20%;
- network utilisation below 20%;
- memory utilisation below 20% (A1 shapes only).

A private hub with a handful of players is exactly the profile this targets, so treat it as a live risk
rather than a footnote. The current pre-Hub host reports only **13% memory utilisation**, so do not assume
the future stack will cross the 20% threshold:

- the conditions are combined with **and**, so exceeding any single threshold is sufficient;
- upgrading the account to **Pay As You Go** exempts instances from idle reclamation while keeping the
  Always Free allowances, so the bill stays at $0 provided usage stays within them. Set a budget alert
  first.

Do not attempt to defeat this with artificial CPU load: it burns the shared capacity that makes the free
tier work. Check **Instance → Metrics** after the first full seven days with the Hub running. If all three
metrics remain below 20%, do not rely on estimates: convert the tenancy to Pay As You Go after confirming
the budget alert and free-tier limits, or accept R-16 explicitly.

---

## Part D — Open the network (two firewalls, both required)

This is the classic Oracle trap: there are **two independent firewalls**, and opening only one produces a
silent timeout that looks like a broken application.

### What changes from the old Foundry HTTP setup

The old Foundry installation and the Campaign Hub use different connection layouts:

```text
Old Foundry:
browser -- plain HTTP on port 30000 --> Foundry

Campaign Hub:
browser -- HTTPS on port 443 --> Caddy -- private HTTP --> Hub containers
browser -- HTTP on port 80  --> Caddy -- redirects to HTTPS
```

If Foundry previously worked at an address such as `http://<hostname>:30000`, that does **not** mean this VM
cannot use HTTPS. It means Foundry itself was listening for plain HTTP on port 30000 and nothing was providing
HTTPS in front of it. Trying `https://<hostname>:30000` against that old service would therefore fail.

The Hub fixes this as part of the deployment:

- the Caddy container listens publicly on ports 80 and 443;
- Caddy obtains and renews a browser-trusted certificate automatically for
  `campaignhub.duckdns.org`;
- Caddy decrypts the browser's HTTPS connection and forwards ordinary HTTP only across the private Docker
  network;
- the Node application and static server are not exposed directly.

This requires **no second OCI instance, paid load balancer, purchased certificate, Certbot command, certificate
upload, or certificate setting in the Oracle console**. It works on the reused Foundry VM. The requirements are
only that DuckDNS points to `129.159.151.68`, ports 80 and 443 reach this VM, and no old service is occupying
those ports. The earlier check showed Foundry listening only on port 30000, so there was no port conflict.

Public HTTPS is required for the Hub rather than an optional improvement: GitHub login returns to this origin,
and the Hub's `__Host-` session cookies are deliberately accepted by browsers only over HTTPS.

### D1 — Cloud firewall (VCN security list, or an NSG)

A security list applies to **every instance in the subnet**. If this subnet holds only the hub instance,
edit the security list. If it holds anything else — a second instance, or a future one — prefer a **network
security group (NSG)**, which attaches to a single VNIC and keeps the blast radius to this instance alone.

> **New-instance path only.** This tenancy has two VCNs: `Thelemar` (the terminated wiki's,
> now empty) and `thelemar_foundry` (which still runs the Foundry instance). Place the hub in
> **`public subnet-Thelemar`** — the empty one. Then the subnet holds only the hub, Option 1 below is safe,
> and opening 80/443 cannot affect Foundry. Placing it in the Foundry subnet would exchange a one-line
> security-list edit for a permanent shared-exposure problem (R-17). Never use a *private* subnet: those
> prohibit public IPs, so the host would be unreachable and ACME validation could never succeed.
> `oci-retry-launch.sh` hides private subnets and will not let you pick one by accident. **For C-ALT, keep
> the existing VNIC/subnet and use the verification in C-ALT.5.**

**Option 1 — security list (simplest; affects the whole subnet)**

**Networking → Virtual Cloud Networks → your VCN → Subnets → the public subnet → its Security List →
Add Ingress Rules.**

**Option 2 — NSG (preferred when the subnet is shared)**

1. **Networking → Virtual Cloud Networks → your VCN → Network Security Groups → Create**, name it
   `campaignhub-web`;
2. add the same two ingress rules to the NSG;
3. attach it to the instance: **Instance → Attached VNICs → the primary VNIC → Edit → Use network security
   groups → select `campaignhub-web`**.

Either way, add two rules, both *stateful* (leave "stateless" unchecked):

| Source CIDR | Protocol | Destination port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

Keep both ports open for this deployment. Port 443 carries the Hub's encrypted traffic and can also carry
Caddy's TLS-ALPN certificate challenge. Port 80 lets Caddy redirect an accidental `http://` visit to `https://`
and provides the HTTP certificate challenge as an automatic fallback. Caddy obtains and renews the certificate;
you do not renew it manually.

Leave the default SSH rule (TCP 22) in place, and do not add rules for the application ports — 5052, 5432
and 8443 are internal to the Docker network and must never be reachable from the internet.

### D2 — Host firewall (inside the VM)

Oracle's Ubuntu images ship `iptables` with a default-DROP INPUT chain that allows only SSH. The cloud rule
above will not help until this is fixed.

SSH in:

```bash
ssh ubuntu@<your-reserved-ip>
```

List the existing rules first. If an ACCEPT for TCP 80/443 already appears before the terminal REJECT/DROP,
do not add a duplicate. Otherwise note the terminal rule's line number `<R>` and insert immediately before
it:

```bash
sudo iptables -L INPUT -n --line-numbers
sudo iptables -I INPUT <R> -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT <R> -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Keep the first SSH session open. Verify both ports appear before any REJECT/DROP line, then confirm a second
new SSH session still works before closing the first:

```bash
sudo iptables -L INPUT -n --line-numbers
```

> Do not `apt purge netfilter-persistent` to "simplify" this. It removes the host firewall entirely and
> leaves the VM protected only by the VCN rules.

---

## Part E — Prepare the operating system

```bash
sudo apt update
sudo apt upgrade

# 2 GB swap only if no swap already exists
if [ -z "$(swapon --show --noheadings)" ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -qF '/swapfile none swap sw 0 0' /etc/fstab \
    || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
```

Install Docker from Docker's official supported Ubuntu repository. Do not pipe `get.docker.com` into a root
shell, and do not mix Ubuntu's `docker.io` package with Docker CE:

```bash
CONFLICTS="$(dpkg --get-selections docker.io docker-compose docker-compose-v2 \
  docker-doc podman-docker containerd runc 2>/dev/null | awk '{print $1}')"
[ -z "$CONFLICTS" ] || sudo apt remove $CONFLICTS

sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
```

Log out and back in for the group change, then confirm:

```bash
docker version --format '{{.Server.Version}}'
docker compose version   # must be v2.24 or newer for the public overlay
docker run --rm hello-world
docker run --rm node:24.7.0-bookworm-slim node --version
uname -m                 # expect: aarch64
```

Enable unattended security updates:

```bash
sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## Part F — DNS

1. Sign in at <https://www.duckdns.org> with GitHub.
2. Create a subdomain, e.g. `campaignhub` → `campaignhub.duckdns.org`.
3. Set its IP to the public address selected in Part C. **For this reused VM, enter
   `129.159.151.68`.** Save.
4. Verify from your own machine, not the VM:

```bash
dig +short campaignhub.duckdns.org
```

For this deployment the command must return:

```text
129.159.151.68
```

Do not continue until it does. DNS only connects the name to the VM; HTTPS will not begin working until the
Hub is started in Part H and Caddy obtains the certificate. Because the VM keeps this OCI public IP across
reboots, no DuckDNS updater is required.

> `duckdns.org` is on the Public Suffix List, so each subdomain carries its own Let's Encrypt rate limit —
> no interference from other DuckDNS users.

### Treat the DuckDNS token as a production credential

The account token is the **only** credential controlling this hostname. Anyone holding it can repoint the
domain, pass an ACME challenge, and obtain a genuinely valid certificate for `campaignhub.duckdns.org` —
which is the exact origin the OAuth callback and `__Host-` session cookies are bound to. A padlock-clean
impersonation of the hub becomes possible.

Accordingly:

- never paste the token into chat, screenshots, issues, or commits;
- if it is ever exposed, recreate it immediately from the DuckDNS account page;
- store it in a password manager, not in the repository.

Rotating the token has no effect on a running deployment. Caddy validates through the public web ports and
does not receive or use the DuckDNS account token.

---

## Part G — GitHub OAuth application

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:

Fill the current form exactly as follows:

| Field or option | Value |
| --- | --- |
| Application name | `Thelemar Campaign Hub (staging)` |
| Homepage URL | `https://campaignhub.duckdns.org` |
| Application description | Optional; `Private staging Campaign Hub for the Thelemar campaign.` is safe |
| Redirect URI | `https://campaignhub.duckdns.org/auth/github/callback` |
| Allow wildcard matching | **Unchecked** |
| Enable Device Flow | **Unchecked** |
| Expire user access tokens | **Checked** |

Use one redirect URI only. Do not add the public IP, `localhost`, the homepage without the callback path, the
old Foundry hostname, or another environment. Do not enable wildcard matching. The redirect URI must match
exactly; that exactness is what prevents an attacker redirecting the login flow to their own site.

Device Flow is for browserless clients such as command-line tools; the Hub uses GitHub's normal browser-based
web flow. Expiring access tokens can remain enabled: the Hub uses GitHub's token only during the callback to
fetch the user's numeric ID and display name, immediately discards it, and creates its own Hub session. It
does not need to retain or refresh the GitHub token.

Click **Register application**. GitHub does not require the website to be live when the app is registered, so
registration can succeed before Part H; actual sign-in will work only after DNS, HTTPS, and the Hub are live.

Copy the **Client ID**, then **Generate a new client secret** and copy it once — GitHub never shows it
again.

> The client secret is a credential. Put it directly into `.env.hub` on the VM. Never paste it into chat,
> a commit, or an issue. Create a **separate** app for production later.

---

## Part H — Deploy

Run every command in this part **inside the SSH session on the Oracle VM**, as the normal `ubuntu` user. Do
not run it in the terminal on your Mac, and do not use `sudo` to create the repository or environment file.

```bash
cd /home/ubuntu
git clone https://github.com/TrueMichato/ThelemarTools.git
cd ThelemarTools
git checkout multiplayer-hub      # later: the release tag
git pull --ff-only origin multiplayer-hub
```

Confirm that this is the repository root:

```bash
pwd
ls compose.hub.yml compose.hub.public.yml
```

Expected:

```text
/home/ubuntu/ThelemarTools
compose.hub.public.yml  compose.hub.yml
```

### H1 — Create `.env.hub` once

`.env.hub` is a private configuration file used by Docker Compose. Create it in the repository root, beside
`compose.hub.yml`:

```text
/home/ubuntu/ThelemarTools/.env.hub
```

It contains passwords and the GitHub OAuth client secret. The repository's `.gitignore` excludes this file,
but it must still never be committed, pasted into chat, or included in screenshots.

First, collect the three values that cannot be generated. Run these commands and answer each prompt:

```bash
read -r -p "Email for certificate alerts: " HUB_ACME_EMAIL
read -r -p "GitHub OAuth Client ID: " GITHUB_CLIENT_ID
read -r -s -p "GitHub OAuth Client Secret (input is hidden): " GITHUB_CLIENT_SECRET
printf '\n'
```

For the email, use an address you monitor. Paste the **Client ID** and the newly generated **Client Secret**
from the OAuth application created in Part G. Nothing appears while the secret is pasted; that is intentional.
Press Enter after pasting it.

Confirm that none of the three inputs was empty without displaying their contents:

```bash
[ -n "$HUB_ACME_EMAIL" ] && echo "OK: email captured" || echo "STOP: email is empty"
[ -n "$GITHUB_CLIENT_ID" ] && echo "OK: Client ID captured" || echo "STOP: Client ID is empty"
[ -n "$GITHUB_CLIENT_SECRET" ] && echo "OK: Client Secret captured" || echo "STOP: Client Secret is empty"
```

If any line begins with `STOP`, repeat the corresponding `read` command. Otherwise create the file:

```bash
umask 077

HUB_POSTGRES_PASSWORD="$(openssl rand -hex 24)"
HUB_RUNTIME_DB_PASSWORD="$(openssl rand -hex 24)"
HUB_BACKUP_DB_PASSWORD="$(openssl rand -hex 24)"
HUB_OPERATIONS_DB_PASSWORD="$(openssl rand -hex 24)"
HUB_COOKIE_SECRET="$(openssl rand -hex 32)"
HUB_CSRF_SECRET="$(openssl rand -hex 32)"
HUB_METRICS_TOKEN="$(openssl rand -hex 32)"
HUB_BACKUP_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
HUB_VCS_REF="$(git rev-parse --short HEAD)"

cat > .env.hub <<EOF
HUB_PUBLIC_DOMAIN=campaignhub.duckdns.org
HUB_ACME_EMAIL=$HUB_ACME_EMAIL
HUB_APP_ORIGIN=https://campaignhub.duckdns.org

HUB_POSTGRES_PASSWORD=$HUB_POSTGRES_PASSWORD
HUB_RUNTIME_DB_PASSWORD=$HUB_RUNTIME_DB_PASSWORD
HUB_BACKUP_DB_PASSWORD=$HUB_BACKUP_DB_PASSWORD
HUB_OPERATIONS_DB_PASSWORD=$HUB_OPERATIONS_DB_PASSWORD

HUB_COOKIE_SECRET=$HUB_COOKIE_SECRET
HUB_CSRF_SECRET=$HUB_CSRF_SECRET
HUB_METRICS_TOKEN=$HUB_METRICS_TOKEN
HUB_BACKUP_ENCRYPTION_KEY=$HUB_BACKUP_ENCRYPTION_KEY

GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET
HUB_ALLOWED_OAUTH_SUBJECTS=github:63811646

HUB_IMAGE_VERSION=staging
HUB_VCS_REF=$HUB_VCS_REF
EOF
chmod 600 .env.hub

unset HUB_ACME_EMAIL GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
unset HUB_POSTGRES_PASSWORD HUB_RUNTIME_DB_PASSWORD HUB_BACKUP_DB_PASSWORD HUB_OPERATIONS_DB_PASSWORD
unset HUB_COOKIE_SECRET HUB_CSRF_SECRET HUB_METRICS_TOKEN HUB_BACKUP_ENCRYPTION_KEY HUB_VCS_REF
```

The database passwords use hexadecimal rather than ordinary Base64 because they are embedded in PostgreSQL
connection URLs; hexadecimal cannot accidentally introduce URL punctuation. The backup key is different: the
backup code explicitly requires Base64 representing exactly 32 bytes.

Verify the file **without printing its secrets**:

```bash
stat -c '%a %U:%G %n' .env.hub
git check-ignore -v .env.hub

while IFS='=' read -r name value; do
  [ -z "$name" ] && continue
  [ -n "$value" ] && printf 'OK: %s is set\n' "$name" || printf 'MISSING: %s\n' "$name"
done < .env.hub

docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.public.yml config --quiet
```

Expected:

- the first command begins with `600 ubuntu:ubuntu`;
- `git check-ignore` identifies `.gitignore`;
- every variable begins with `OK` and none with `MISSING`;
- Docker Compose prints nothing and exits successfully.

If Docker Compose reports an unset variable, do not start the stack. Edit only that value with
`nano .env.hub`, save with **Ctrl+O**, Enter, and exit with **Ctrl+X**, then repeat the checks.

> **Do not rerun the generation block after the database has been created.** It would replace the database
> passwords while the existing database still expects the old ones. Keep this same file for upgrades and
> restarts. If one setting later changes, edit that line only.

### H2 — Save the recovery secret off the VM

`HUB_BACKUP_ENCRYPTION_KEY` is the only key that can decrypt this deployment's encrypted database backups.
If the VM is lost and the key existed only on that VM, the backups are unusable. Print only that line, copy
the entire line into a password-manager secure note, then clear the terminal window:

```bash
grep '^HUB_BACKUP_ENCRYPTION_KEY=' .env.hub
clear
```

Do not put the key in chat, email, a GitHub issue, or another file in the repository.

`HUB_TRUST_PROXY` is deliberately left unset: it defaults to `172.30.0.10`, the Caddy container's fixed
address on the private network. `HUB_CLIENT_IP_HEADER` stays unset — it exists only for managed platforms
that inject their own client-IP header, and enabling it here would let clients spoof their address.

### H3 — Build and start

The first build takes roughly 5–10 minutes on 1 OCPU:

```bash
docker compose -f compose.hub.yml -f compose.hub.public.yml --env-file .env.hub up -d --build
docker compose -f compose.hub.yml -f compose.hub.public.yml --env-file .env.hub ps
```

Migrations run automatically as a one-shot `migrate` container before the BFF starts, and the BFF refuses
to start against an unexpected schema.

The `edge` container is Caddy. On its first start it automatically proves control of
`campaignhub.duckdns.org` to a public certificate authority, downloads the certificate, and stores it in the
persistent `hub-caddy-data` Docker volume. It also renews the certificate automatically before expiry. Do
**not** install Certbot, generate `.pem` files, or configure HTTPS inside the Hub application.

---

## Verification

Run all of these before declaring success.

```bash
# On the VM
docker compose -f compose.hub.yml -f compose.hub.public.yml --env-file .env.hub exec -T bff \
  node -e 'fetch("http://127.0.0.1:5052/api/live").then(async r => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); })'
docker compose -f compose.hub.yml -f compose.hub.public.yml --env-file .env.hub logs edge \
  | grep -Ei "certificate|acme|tls"

# From your own machine
curl -fsS https://campaignhub.duckdns.org/api/live          # valid TLS, no -k
curl -fsSI http://campaignhub.duckdns.org | head -1         # expect 308 redirect to HTTPS
```

Allow Caddy a minute on first start. If the HTTPS `curl` still fails, do not create certificates manually.
Run these checks in order:

1. on your own machine, `dig +short campaignhub.duckdns.org` must print `129.159.151.68`;
2. on the VM, `sudo ss -tlnp | grep -E ':(80|443)\b'` must show Docker listening on both ports;
3. in OCI and `sudo iptables -L INPUT -n --line-numbers`, both ports must be allowed;
4. read the complete Caddy explanation with
   `docker compose -f compose.hub.yml -f compose.hub.public.yml --env-file .env.hub logs edge`.

Then in a browser:

1. `https://campaignhub.duckdns.org` loads the site with a valid padlock;
2. sign-in redirects to GitHub and returns successfully;
3. an account **not** on the allowlist is refused;
4. create a campaign, create a character, reload — data persists;
5. open a second browser profile, join, and confirm a change in one appears in the other within a second;
6. leave a tab idle 30 minutes and confirm the socket survives — this exercises the 25-second heartbeat.

---

## Rollback

Nothing here mutates existing systems, so rollback is disposal:

```bash
docker compose -f compose.hub.yml -f compose.hub.public.yml --env-file .env.hub down       # keeps volumes
docker compose -f compose.hub.yml -f compose.hub.public.yml --env-file .env.hub down -v    # destroys data
```

Terminating the instance and deleting the VCN returns the tenancy to its prior state. If the new-instance
path created a reserved public IP, release it separately under **Networking → Reserved IPs**.

---

## Evidence to record

- tenancy home region and whether an existing or new account was used;
- instance OCPU/memory/boot size and availability domain;
- public IP address, whether it is ephemeral or reserved, and the DuckDNS name;
- whether ingress was granted via the subnet security list or a dedicated NSG, and which other instances
  share that subnet;
- date of first successful certificate issuance;
- confirmation that the backup encryption key is stored off-VM;
- a **Cost Analysis** screenshot taken after the first full day showing zero charges, plus the budget alert
  threshold and recipient;
- verification checklist results and the date;
- update **Last drill date** at the top of this file.

---

## Known constraints

- **One BFF replica.** Realtime fanout is process-local, so `docker compose up` restarts drop sockets for
  about 5–10 seconds. Clients reconnect and replay automatically. Do not deploy mid-session.
- **Self-managed PostgreSQL.** No managed point-in-time recovery; recovery is from nightly encrypted
  backups, giving RPO up to 24 h. This still meets the stated RPO ≤ 24 h / RTO ≤ 4 h target, with no margin.
  See [operations.md](../operations.md) and [backup-restore.md](backup-restore.md).
- **ARM builds happen on the VM**, not in CI, because GitHub's hosted runners are x86. Provenance is
  therefore "built from a verified git tag" rather than a CI-signed image digest. See ADR 0008.
- **Capacity is a quota, not a guarantee.** Always Free does not reserve hardware; a terminated instance may
  not be re-creatable immediately.
- **Free ARM capacity in `il-jerusalem-1` is effectively exhausted.** 317 consecutive launch attempts over
  24 h (2026-08-27/28) all returned "Out of host capacity". New-instance creation is not a reliable option
  in this region; Part C-ALT (repurpose a running instance) is the adopted path.
- **Stopping a running instance is irreversible in practice.** A stop releases the host allocation and a
  start is a fresh capacity request. `Reboot` preserves the host and is safe; `Stop` is not. This forbids
  shape resizes and boot-volume detach/attach, and removes the usual boot-volume rescue path — the serial
  console must be armed in advance instead (C-ALT.3).
- **The repurposed host is Ubuntu 22.04.4, not 20.04.** It is supported through May 2027 and Docker supports
  Jammy directly. Fully patch it, enable free Ubuntu Pro `esm-apps`, and defer 24.04 until a failed release
  upgrade has a usable rollback. See C-ALT.3.
- **Israel Central has a single availability domain.** `il-jerusalem-1` exposes exactly one AD, so the usual
  "retry in another AD" workaround for capacity errors does not exist here, and Always Free resources cannot
  be placed outside the permanent home region. Retrying over time is the only free mitigation. See C7.
- **Idle instances can be reclaimed.** Oracle may reclaim an Always Free instance whose CPU, network *and*
  memory all stay under 20% for 7 days. The running stack's memory footprint normally keeps it clear of the
  threshold; upgrading to Pay As You Go removes the risk entirely while keeping the $0 allowances. See C9.
- **Free block storage is 200 GB across the whole tenancy**, and every boot volume is at least 47 GB. New
  instances must be sized against the remaining headroom, not in isolation.

## Related

- [deployment.md](../deployment.md) — the portable stack contract
- [provider-comparison.md](../provider-comparison.md) — why Oracle
- [deploy-promote.md](deploy-promote.md) — routine updates
- [backup-restore.md](backup-restore.md) — the drill that must pass before real data
