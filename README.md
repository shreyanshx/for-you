# For You — a tiny romantic invitation

A production-minded, mobile-first invitation built with Node.js 20+ built-in modules and a dependency-free HTML/CSS/JavaScript frontend. It asks for a name locally, stores it only after an explicit **Yes**, celebrates a successfully saved response, and offers a private authenticated response dashboard.

## Project structure

```text
for-you/
├── public/
│   ├── assets/               # Original transparent PNG character art
│   ├── dashboard.js          # Local-time enhancement for the private dashboard
│   ├── index.html            # Accessible invitation markup
│   ├── script.js             # Name flow, consent, playful No, and celebration
│   └── styles.css            # Shared responsive invitation/dashboard design
├── views/response.html       # Server-rendered private dashboard template
├── data/.gitkeep             # Runtime data directory placeholder
├── server.js                 # HTTP server, validation, storage, auth, and headers
├── package.json
└── README.md
```

The server only serves an explicit allowlist of files from `public/`; it never exposes the repository root, data, environment files, source templates, or README.

## Customize the invitation

Edit `PERSONALIZATION` near the top of `public/script.js`:

```js
const PERSONALIZATION = {
  senderName: "Your Secret Admirer",
  dateIdea: "a cozy café and something sweet"
};
```

Edit the surrounding wording in `public/index.html` if desired. The guest enters her own name in the opening step. The app keeps that value in page memory only—never in the URL or local storage—and sends it only if she taps **Yes**.

The PNG characters are original artwork created for this project: a pink teddy, a teddy couple, and two distinct white bow-kitty characters. They do not use third-party character names, logos, or artwork.

## Run locally

Requirements: Node.js 20 or newer. No package installation is needed.

```bash
cd /path/to/for-you
export ADMIN_USER=shreyansh
export ADMIN_PASSWORD='choose-a-long-unique-local-password'
node server.js
```

Open `http://127.0.0.1:3000`. The private dashboard is at `http://127.0.0.1:3000/response` and prompts for the credentials above. Stop with `Ctrl+C`.

Optional configuration:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `3000` | Listen port |
| `RESPONSE_FILE` | `./data/responses.jsonl` | Durable response file |
| `TRUST_PROXY` | unset | Set to `loopback` only behind the documented local nginx proxy |
| `ADMIN_USER` | required | Dashboard Basic Auth username |
| `ADMIN_PASSWORD` | required | Dashboard Basic Auth password |

The process refuses to start if either admin credential is missing. Do not put credentials in client code, Git, shell history, or this README. Use a long random production password. If any example password has been used or shared, replace it immediately.

## Exactly what is stored

Each accepted response is one newline-delimited JSON record containing only:

- normalized name;
- UUID request ID (for idempotency);
- `accepted: true`;
- server-generated ISO 8601 timestamp.

IP addresses, user agents, No-button attempts, declines, and “Maybe another day” choices are never persisted. The in-memory rate limiter uses a process-randomized one-way key and disappears on restart. Concurrent appends are serialized, and request IDs already on disk are loaded at startup so retries do not create duplicate records.

Runtime JSONL files are ignored by Git. Treat the response file as private personal data.

## Private dashboard

Visit `/response` or `/response/` and authenticate with HTTP Basic Auth. The server uses constant-time credential comparison, escapes stored values, renders newest responses first, and applies `Cache-Control: no-store` plus `X-Robots-Tag: noindex, nofollow`. The dashboard shows accepted count, name, accepted status, UTC time, and browser-local time.

**Basic Auth sends a reusable credential on every request. HTTPS is required outside loopback.** Do not expose production `/response` over plain HTTP.

## Backup and delete data

For the production paths below, create a root-readable backup:

```bash
sudo install -d -m 700 -o root -g root /var/backups/for-you
sudo cp --preserve=mode,timestamps /var/lib/for-you/responses.jsonl "/var/backups/for-you/responses-$(date -u +%Y%m%dT%H%M%SZ).jsonl"
sudo chown root:root /var/backups/for-you/responses-*.jsonl
sudo chmod 600 /var/backups/for-you/responses-*.jsonl
```

To delete all responses safely:

```bash
sudo systemctl stop for-you
sudo -u for-you truncate -s 0 /var/lib/for-you/responses.jsonl
sudo systemctl start for-you
```

To delete one record, first make a backup, stop the service, use `sudoedit /var/lib/for-you/responses.jsonl` to remove exactly that JSON line, preserve one complete JSON object per line, then restart. Stopping avoids racing an append. Delete old backups too when they are no longer required.

## Production deployment on Ubuntu EC2

These commands target Ubuntu 22.04/24.04. In the EC2 security group, allow inbound TCP **80 and 443 only** from the internet. Restrict SSH/22 to a trusted administrator IP. Never expose port 3000.

### 1. Install Node.js 22 LTS and nginx

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg nginx ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
sudo systemctl enable --now nginx
```

If UFW is used, keep SSH available before enabling it, and expose only nginx:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw deny 3000/tcp
sudo ufw enable
sudo ufw status verbose
```

### 2. Create a locked-down service account and directories

```bash
sudo useradd --system --home /var/lib/for-you --shell /usr/sbin/nologin for-you
sudo install -d -m 755 -o root -g root /opt/for-you
sudo install -d -m 700 -o for-you -g for-you /var/lib/for-you
```

Copy a reviewed release into `/opt/for-you` (with `scp`, your CI artifact, or a checked-out release), then enforce read-only application ownership:

```bash
sudo cp -a /path/to/release/. /opt/for-you/
sudo chown -R root:root /opt/for-you
sudo find /opt/for-you -type d -exec chmod 755 {} +
sudo find /opt/for-you -type f -exec chmod 644 {} +
sudo chmod 700 /var/lib/for-you
sudo chown -R for-you:for-you /var/lib/for-you
```

### 3. Create the private environment file

Create a root-owned file without placing its values in the unit or repository:

```bash
sudo install -m 600 -o root -g root /dev/null /etc/for-you.env
sudoedit /etc/for-you.env
```

Set these lines, choosing a new long random password:

```dotenv
HOST=127.0.0.1
PORT=3000
RESPONSE_FILE=/var/lib/for-you/responses.jsonl
TRUST_PROXY=loopback
ADMIN_USER=shreyansh
ADMIN_PASSWORD=replace-with-a-long-random-secret
```

Then confirm permissions without printing the secret:

```bash
sudo chown root:root /etc/for-you.env
sudo chmod 600 /etc/for-you.env
sudo stat -c '%U %G %a %n' /etc/for-you.env
```

### 4. Install a hardened systemd service

```bash
sudo tee /etc/systemd/system/for-you.service >/dev/null <<'UNIT'
[Unit]
Description=For You romantic invitation
After=network.target

[Service]
Type=simple
User=for-you
Group=for-you
WorkingDirectory=/opt/for-you
EnvironmentFile=/etc/for-you.env
ExecStart=/usr/bin/node /opt/for-you/server.js
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=/var/lib/for-you

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now for-you
sudo systemctl status for-you --no-pager
curl --fail --silent --show-error http://127.0.0.1:3000/health
```

The health response should be `{"status":"ok"}`.

### 5. Configure nginx as the only public listener

```bash
sudo tee /etc/nginx/sites-available/for-you >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;

    client_max_body_size 8k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Connection "";
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "DENY" always;
}
NGINX
sudo ln -sfn /etc/nginx/sites-available/for-you /etc/nginx/sites-enabled/for-you
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error -H 'Host: example.com' http://127.0.0.1/health
```

Replace the example domains. Do not add a security-group or UFW rule for 3000; Node remains bound to loopback.

### 6. Enable HTTPS with Certbot

Point the domain’s DNS records at the EC2 public/Elastic IP, wait for resolution, and keep ports 80/443 reachable:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
sudo certbot renew --dry-run
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error https://example.com/health
```

Choose Certbot’s HTTP-to-HTTPS redirect. After HTTPS works, you may add `add_header Strict-Transport-Security "max-age=31536000" always;` to the TLS server block, then run `sudo nginx -t && sudo systemctl reload nginx`.

### Logs and troubleshooting

```bash
sudo journalctl -u for-you -n 100 --no-pager
sudo journalctl -u for-you -f
sudo tail -n 100 /var/log/nginx/error.log
sudo ss -ltnp | grep -E ':(80|443|3000)\b'
```

The application intentionally does not log submitted names or request bodies.

### Safe update workflow

Build or check out the new release in a separate directory, back up the JSONL file, then replace only application code. Never overwrite `/var/lib/for-you` or `/etc/for-you.env`:

```bash
cd /path/to/new/release
node --check server.js
node --check public/script.js
node --check public/dashboard.js
sudo systemctl stop for-you
sudo cp -a /opt/for-you "/opt/for-you.backup-$(date -u +%Y%m%dT%H%M%SZ)"
sudo rm -rf /opt/for-you.new
sudo install -d -m 755 -o root -g root /opt/for-you.new
sudo cp -a . /opt/for-you.new/
sudo chown -R root:root /opt/for-you.new
sudo mv /opt/for-you /opt/for-you.old
sudo mv /opt/for-you.new /opt/for-you
sudo systemctl start for-you
curl --fail --silent --show-error http://127.0.0.1:3000/health
sudo nginx -t
```

After verification, remove `/opt/for-you.old` and time-stamped code backups according to your retention policy. Response data remains under `/var/lib/for-you` throughout.

## Security and accessibility notes

- Requests are capped at 8 KiB, require JSON and same-origin when an Origin header is available, validate names and UUIDs, and are rate-limited without persistent network identifiers. Behind the documented nginx setup, `TRUST_PROXY=loopback` safely separates client quotas while accepting forwarding headers only from a loopback peer.
- Dashboard authentication failures have a separate in-memory throttle, and response writes are flushed to disk before success is returned. Startup waits for storage readiness and direct-process shutdown drains active work.
- Static serving is allowlist-only; unknown routes and unsupported methods return explicit errors.
- CSP permits local scripts, styles, images, and same-origin API calls only. Additional headers prevent sniffing, framing, referrer leakage, and unnecessary browser capabilities.
- The interface uses semantic markup, visible labels and errors, keyboard focus, large touch targets, live save status, reduced-motion support, safe-area padding, and layouts down to 320 px.
- The playful No button evades pointer, touch, and keyboard activation. Yes always remains reachable. After five No attempts, “Maybe another day” provides a respectful local-only exit that saves nothing.
