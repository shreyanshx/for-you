# For You — a tiny romantic invitation

A production-minded, mobile-first invitation built with Node.js built-ins and dependency-free HTML, CSS, and JavaScript. A guest’s name stays in page memory unless they explicitly choose **Yes**. Accepted responses are stored in a private JSONL file and displayed only through an authenticated operator page.

## Project structure

```text
for-you/
├── public/
│   ├── assets/               # Original PNG art; no music is committed here
│   ├── dashboard.js          # Local-time enhancement for the private page
│   ├── index.html            # Accessible invitation and music control
│   ├── script.js             # Invitation, consent, and audio behavior
│   └── styles.css            # Responsive invitation/private-page design
├── scripts/
│   ├── deploy-ubuntu-ec2.sh  # Interactive Ubuntu EC2 deployer
│   └── integration-check.js  # One-shot behavior/security check
├── views/response.html       # Server-rendered private template
├── data/.gitkeep             # Local runtime-data placeholder
├── server.js                 # HTTP, validation, storage, auth, audio, headers
├── package.json
└── README.md
```

The server exposes only an explicit static allowlist plus the optional fixed audio URL `/assets/background-music.mp3`. It never recursively serves `public`, the repository root, runtime data, environment files, or templates.

## Customize and run locally

Edit `PERSONALIZATION` in `public/script.js` and invitation wording in `public/index.html`. The included PNG characters are original project art. No audio is included.

Requirements: Node.js 20 or newer. There are no package dependencies.

```bash
cd /path/to/for-you
export ADMIN_USER=shreyansh
export ADMIN_PASSWORD='choose-a-long-unique-local-password'
node server.js
```

Open `http://127.0.0.1:3000`. The operator page is at `/response` and uses HTTP Basic Auth. Plain `ADMIN_PASSWORD` remains convenient for local development. Production deployment uses `ADMIN_PASSWORD_BASE64` to avoid systemd `EnvironmentFile` parsing problems:

```bash
export ADMIN_USER=shreyansh
export ADMIN_PASSWORD_BASE64="$(printf '%s' 'your local test password' | base64 | tr -d '\n')"
node server.js
```

Set exactly one password variable. Base64 is encoding, **not encryption**; protect the environment as a secret. Decoding is strict: malformed/noncanonical Base64, invalid UTF-8, and empty decoded values stop startup.

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Node listen address |
| `PORT` | `3000` | Node listen port |
| `RESPONSE_FILE` | `./data/responses.jsonl` | Durable accepted-response file |
| `TRUST_PROXY` | unset | Use `loopback` only behind the documented local nginx proxy |
| `ADMIN_USER` | required | Basic Auth username (no colon) |
| `ADMIN_PASSWORD` | alternative | Direct password, intended for local use |
| `ADMIN_PASSWORD_BASE64` | alternative | Canonical Base64 UTF-8 password, used by the deployer |
| `BACKGROUND_AUDIO_FILE` | unset | Server-local MP3 exposed only at the fixed audio URL |

### Optional background music

Use only an MP3 you own or are legally licensed to serve. **“Ajeeb Dastan Hai Ye” is copyrighted; you must provide a properly licensed file yourself.** This repository and deployer never download music or embed remote audio URLs.

For local testing, point the server at a regular, non-symlink MP3 no larger than 15 MiB:

```bash
export BACKGROUND_AUDIO_FILE=/absolute/path/to/licensed-music.mp3
```

The file remains outside the repository/public allowlist. The server opens it without following symlinks and streams GET or HEAD responses with single-byte-range support (`206`/`416`), `audio/mpeg`, and private/no-cache policy. Missing, invalid, oversized, or unconfigured audio quietly returns 404.

The page sets volume to 10%, tries autoplay, and retries once after the first trusted interaction. Browsers commonly block autoplay; the visible play/pause control always remains available. A user-initiated pause is respected. If the source is unavailable, the control hides gracefully.

## Data, privacy, and credentials

Each accepted response is one newline-delimited JSON object containing only the normalized name, a UUID retry ID, `accepted: true`, and a server-generated timestamp. IP addresses, user agents, declines, and button attempts are not persisted. Writes are serialized, synced before success, and deduplicated across restarts.

The attendee page truthfully explains collection without exposing or hinting at the operator URL. There is intentionally no attendee-facing link to `/response`; operators enter that URL themselves. The private page escapes stored values, renders newest first, uses constant-time credential checks, throttles failed authentication, and sends `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.

Basic Auth sends a reusable credential with each request. Never expose submissions or authentication over plain HTTP. The deployer fails closed rather than leaving the app available as an insecure fallback when trusted TLS setup fails.

## Automated Ubuntu EC2 deployment

`scripts/deploy-ubuntu-ec2.sh` is a rerunnable interactive deployer for Ubuntu 22.04 and 24.04. Run it from a trusted checkout with `sudo`; it requires `/dev/tty` so secrets cannot be supplied accidentally through a noninteractive pipeline:

```bash
git clone https://github.com/shreyanshx/for-you.git
cd for-you
sudo ./scripts/deploy-ubuntu-ec2.sh
```

The script always stages a fresh Git clone. Its default source is `https://github.com/shreyanshx/for-you.git`; optional environment overrides select another reviewed HTTPS repository and ref:

```bash
sudo REPO_URL=https://github.com/shreyanshx/for-you.git \
  REPO_REF=main \
  ./scripts/deploy-ubuntu-ec2.sh
```

`REPO_REF` may be a branch, tag, or fetchable commit/ref. The exact staged commit is printed, syntax/integration checks run before promotion, and no repository setup script is executed.

### Before running: AWS networking

The script configures UFW, not the EC2 security group. In the AWS security group:

- allow inbound TCP 80 and 443 from intended attendees;
- restrict SSH/22 to trusted administrator addresses;
- **never** allow inbound port 3000.

The script allows OpenSSH before enabling UFW, allows `Nginx Full`, explicitly denies 3000, and binds Node to `127.0.0.1:3000`.

### What the deployer does

It prompts for either `domain` or `public-ip` mode, a certificate email, optional licensed MP3 path, operator username (default `shreyansh`), and the password twice with hidden input. Usernames are limited to letters, numbers, `.`, `_`, and `-`. Passwords shorter than 8 characters are rejected; passwords from 8–11 characters produce a warning.

It then:

1. installs `git`, `curl`, `ca-certificates`, `gnupg`, `nginx`, `ufw`, and `snapd` with apt;
2. installs Node.js 22 from NodeSource and current Certbot from the classic snap;
3. creates/locks the `for-you` service account and applies a hardened systemd unit;
4. verifies a staged clone, publishes root-owned read-only code atomically, and retains the prior release for rollback;
5. preserves response data and music under `/var/lib/for-you` on every rerun;
6. atomically writes `/etc/for-you.env` as `root:root` mode `600`, storing only `ADMIN_PASSWORD_BASE64`, never the raw password;
7. starts/restarts Node only after credentials are written, checks loopback health, then obtains trusted TLS;
8. validates nginx before each script-managed reload, validates HTTPS publicly, and prints attendee/private URLs without credentials.

If the new app fails its loopback health check, the previous code, environment file, and systemd unit are restored and health-checked when a complete prior runtime exists. HTTP serves only ACME challenges plus a 503 until a certificate exists; on reruns, an existing certificate keeps the TLS proxy active. If certificate setup or HTTPS validation fails, the script retains that fail-closed shape rather than exposing submissions or Basic Auth insecurely. Correct the reported issue and rerun.

### Domain certificates

Choose `domain`, enter a fully qualified hostname, and ensure its DNS already resolves to the instance. The script first configures nginx/ACME HTTP service, checks app health, then runs Certbot’s nginx plugin noninteractively with redirect enabled. Ports 80 and 443 must be reachable.

### Modern public-IP certificates

Choose `public-ip` to use an IPv4 address directly. The script tries AWS IMDSv2 first and asks you to confirm the detected address; manual entry is available. It requires Certbot 5.4+ and uses the official webroot command shape:

```bash
certbot certonly \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/for-you-acme \
  --ip-address 203.0.113.10
```

It then installs explicit nginx TLS paths under `/etc/letsencrypt/live/<IP>/` and redirects HTTP to HTTPS. As explained in Let’s Encrypt’s [March 2026 IP certificate announcement](https://letsencrypt.org/2026/03/11/shorter-certs-certbot), IP certificates use the required six-day `shortlived` profile; Certbot 5.4+ is needed for IP webroot support, and Certbot does not install the web-server configuration for you. Automatic renewal is therefore essential. The script installs an executable deploy hook that runs `nginx -t` before reload, while snap’s Certbot timer handles frequent renewal attempts. Verify the timer after deployment.

Content from the linked Let’s Encrypt article was rephrased for compliance with licensing restrictions.

### Generated and persistent paths

| Path | Purpose / rerun behavior |
|---|---|
| `/opt/for-you` | Current root-owned, read-only app release; atomically replaced |
| `/opt/for-you.rollback.<UTC>` | Previous code retained after successful promotion |
| `/opt/for-you.failed.<UTC>` | Failed release retained after rollback |
| `/var/lib/for-you/responses.jsonl` | Persistent private responses; never replaced by deploy |
| `/var/lib/for-you/background-music.mp3` | Optional persistent user-supplied MP3, service-owned mode 600 |
| `/etc/for-you.env` | Atomic root-only runtime configuration |
| `/etc/systemd/system/for-you.service` | Hardened systemd service |
| `/etc/nginx/sites-available/for-you` | Managed HTTP/TLS nginx site |
| `/etc/nginx/sites-enabled/for-you` | Site symlink; nginx default symlink is disabled |
| `/var/www/for-you-acme` | ACME HTTP-01 webroot |
| `/etc/letsencrypt/` | Certbot account, renewal, and certificates |
| `/etc/letsencrypt/renewal-hooks/deploy/for-you-nginx` | Validating nginx renewal deploy hook |
| `/root/for-you-deploy.*` | Root-only temporary clone, removed on exit |

Blank audio input preserves existing deployed music. Supplying a new path validates a regular non-symlink `.mp3`, enforces the 15 MiB limit, and atomically replaces only the persistent music file. Reruns replace app code/configuration but not JSONL data.

## Backup and deletion

Back up private response data before upgrades or manual edits:

```bash
sudo install -d -m 700 -o root -g root /var/backups/for-you
sudo cp --preserve=mode,timestamps /var/lib/for-you/responses.jsonl \
  "/var/backups/for-you/responses-$(date -u +%Y%m%dT%H%M%SZ).jsonl"
sudo chown root:root /var/backups/for-you/responses-*.jsonl
sudo chmod 600 /var/backups/for-you/responses-*.jsonl
```

Delete all responses without racing an append:

```bash
sudo systemctl stop for-you
sudo -u for-you truncate -s 0 /var/lib/for-you/responses.jsonl
sudo systemctl start for-you
```

To delete one record, back up, stop the service, edit exactly one complete JSON line with `sudoedit`, and restart. Delete expired backups according to your retention policy. Back up the optional MP3 separately only if your license and recovery plan require it.

## Verification and troubleshooting

Run the complete local verification:

```bash
npm run verify
git diff --check
```

`npm run check` performs Node syntax checks, `bash -n` on the deployer, and ShellCheck when it is already installed (ShellCheck is not a project dependency). The integration check covers persistence, idempotency, direct/Base64 auth, authenticated private-page access, output escaping, static isolation, audio GET/HEAD/ranges/416/missing behavior, CSP, and absence of private-route hints from attendee assets.

Useful production diagnostics:

```bash
sudo systemctl status for-you nginx --no-pager
sudo journalctl -u for-you -n 100 --no-pager
sudo tail -n 100 /var/log/nginx/error.log
sudo nginx -t
curl --fail --silent --show-error http://127.0.0.1:3000/health
curl --fail --silent --show-error https://YOUR_DOMAIN_OR_IP/health
sudo ss -ltnp | grep -E ':(80|443|3000)\b'
sudo snap services certbot
sudo certbot renew --dry-run
sudo stat -c '%U %G %a %n' /etc/for-you.env /var/lib/for-you
```

If Node health fails, inspect `journalctl`, verify Node 22 and environment-file permissions, and confirm the service user can write `/var/lib/for-you`. If ACME fails, verify public DNS/IP, AWS security-group and UFW rules, port 80 reachability, Certbot version, and the ACME webroot. If audio is absent, inspect the service-owned MP3’s type, symlink status, size, and mode; do not move it into `public`.

## Security and accessibility notes

- Request bodies are capped at 8 KiB, require JSON and same-origin when supplied, validate names/UUIDs, and are rate-limited with process-randomized network keys.
- `TRUST_PROXY=loopback` accepts forwarding headers only from loopback nginx, separating client quotas without trusting public peers.
- Static serving is allowlist-only. Audio has one fixed URL, one configured server-local file, no symlink following, and a 15 MiB cap.
- CSP permits only same-origin scripts, styles, images, media, and API calls. Additional headers prevent sniffing, framing, referrer leakage, and unnecessary browser capabilities.
- The interface uses semantic markup, visible labels/errors/status, keyboard focus, large touch targets, reduced-motion support, safe-area padding, and layouts down to 320 px.
- The playful No button never makes Yes unreachable; after repeated attempts, a respectful local-only exit saves nothing.
