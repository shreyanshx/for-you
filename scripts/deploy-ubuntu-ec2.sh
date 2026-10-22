#!/usr/bin/env bash
# Run on Ubuntu 22.04/24.04 as: sudo ./scripts/deploy-ubuntu-ec2.sh
set -Eeuo pipefail
set +x

readonly DEFAULT_REPO_URL="https://github.com/shreyanshx/for-you.git"
readonly APP_NAME="for-you"
readonly APP_DIR="/opt/for-you"
readonly DATA_DIR="/var/lib/for-you"
readonly ENV_FILE="/etc/for-you.env"
readonly ACME_ROOT="/var/www/for-you-acme"
readonly NGINX_SITE="/etc/nginx/sites-available/for-you"
readonly NGINX_LINK="/etc/nginx/sites-enabled/for-you"
readonly SERVICE_FILE="/etc/systemd/system/for-you.service"
readonly RENEW_HOOK="/etc/letsencrypt/renewal-hooks/deploy/for-you-nginx"
readonly MAX_AUDIO_BYTES=$((15 * 1024 * 1024))

REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
REPO_REF="${REPO_REF:-}"
staging_dir=""
new_release=""
rollback_release=""
previous_env_snapshot=""
previous_service_snapshot=""
site_configured=0
tls_ready=0
target=""
public_url=""

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
fatal() {
  local message="$1"
  if [[ "$tls_ready" -ne 1 ]]; then lock_insecure_http; fi
  printf 'ERROR: %s\n' "$message" >&2
  exit 1
}

reload_nginx() {
  nginx -t
  systemctl reload nginx
}

write_nginx_site() {
  local fullchain="/etc/letsencrypt/live/$target/fullchain.pem"
  local privkey="/etc/letsencrypt/live/$target/privkey.pem"
  cat >"$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $target;

    location ^~ /.well-known/acme-challenge/ {
        root $ACME_ROOT;
        default_type text/plain;
    }
EOF
  if [[ -f "$fullchain" && -f "$privkey" ]]; then
    cat >>"$NGINX_SITE" <<'EOF'

    location / { return 301 https://$host$request_uri; }
}
EOF
    cat >>"$NGINX_SITE" <<EOF

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $target;
    client_max_body_size 8k;

    ssl_certificate $fullchain;
    ssl_certificate_key $privkey;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header Connection "";
    }

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "DENY" always;
}
EOF
  else
    cat >>"$NGINX_SITE" <<'EOF'

    location / { return 503; }
}
EOF
  fi
}

lock_insecure_http() {
  [[ "$site_configured" -eq 1 ]] || return 0
  write_nginx_site
  nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
}

cleanup() {
  if [[ -n "$new_release" && -d "$new_release" ]]; then rm -rf -- "$new_release"; fi
  if [[ -n "$staging_dir" && -d "$staging_dir" ]]; then rm -rf -- "$staging_dir"; fi
}

on_error() {
  local line="$1"
  trap - ERR
  if [[ "$tls_ready" -ne 1 ]]; then lock_insecure_http; fi
  printf '\nDeployment failed near line %s. The public app was not left available over insecure HTTP.\n' "$line" >&2
  printf 'Review the error above, then rerun this script after correcting it.\n' >&2
  exit 1
}

trap 'on_error "$LINENO"' ERR
trap cleanup EXIT

if [[ "${EUID}" -ne 0 ]]; then
  fatal 'This deployer must run as root. Use: sudo ./scripts/deploy-ubuntu-ec2.sh'
fi
if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
  fatal 'An interactive /dev/tty is required for deployment prompts.'
fi
os_id="$(awk -F= '$1 == "ID" { gsub(/\"/, "", $2); print $2 }' /etc/os-release 2>/dev/null || true)"
os_version="$(awk -F= '$1 == "VERSION_ID" { gsub(/\"/, "", $2); print $2 }' /etc/os-release 2>/dev/null || true)"
if [[ "$os_id" != "ubuntu" || ( "$os_version" != "22.04" && "$os_version" != "24.04" ) ]]; then
  fatal "Supported operating systems are Ubuntu 22.04 and 24.04; detected ${os_id:-unknown} ${os_version:-unknown}."
fi
if [[ ! "$REPO_URL" =~ ^https://[^[:space:]]+$ ]]; then
  fatal 'REPO_URL must be a whitespace-free HTTPS URL.'
fi
if [[ -n "$REPO_REF" && ( "$REPO_REF" == -* || "$REPO_REF" =~ [[:space:]] ) ]]; then
  fatal 'REPO_REF must not begin with a dash or contain whitespace.'
fi

prompt_value() {
  local prompt="$1" value
  printf '%s' "$prompt" >/dev/tty
  IFS= read -r value </dev/tty
  printf '%s' "$value"
}

confirm() {
  local prompt="$1" answer
  printf '%s [Y/n]: ' "$prompt" >/dev/tty
  IFS= read -r answer </dev/tty
  [[ -z "$answer" || "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

valid_hostname() {
  local hostname="$1" label
  local -a labels
  ! valid_ipv4 "$hostname" || return 1
  [[ ${#hostname} -le 253 && "$hostname" != *:* && "$hostname" != .* && "$hostname" != *. && "$hostname" == *.* ]] || return 1
  IFS='.' read -r -a labels <<<"$hostname"
  for label in "${labels[@]}"; do
    [[ ${#label} -ge 1 && ${#label} -le 63 && "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

valid_ipv4() {
  local address="$1" octet
  local -a octets
  [[ "$address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS='.' read -r -a octets <<<"$address"
  for octet in "${octets[@]}"; do
    ((10#$octet <= 255)) || return 1
  done
}

valid_public_ipv4() {
  local address="$1" first second
  valid_ipv4 "$address" || return 1
  IFS='.' read -r first second _ <<<"$address"
  (( first != 0 && first != 10 && first != 127 && first < 224 )) || return 1
  (( first != 169 || second != 254 )) || return 1
  (( first != 172 || second < 16 || second > 31 )) || return 1
  (( first != 192 || second != 168 )) || return 1
  (( first != 100 || second < 64 || second > 127 )) || return 1
}

valid_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

prompt_email() {
  local value
  while true; do
    value="$(prompt_value 'Certificate renewal email: ')"
    if valid_email "$value"; then printf '%s' "$value"; return; fi
    printf 'Enter a valid email address.\n' >/dev/tty
  done
}

get_public_ipv4() {
  local token address
  token="$(curl --fail --silent --show-error --max-time 3 -X PUT \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
    http://169.254.169.254/latest/api/token 2>/dev/null || true)"
  [[ -n "$token" ]] || return 1
  address="$(curl --fail --silent --show-error --max-time 3 \
    -H "X-aws-ec2-metadata-token: $token" \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
  valid_public_ipv4 "$address" || return 1
  printf '%s' "$address"
}

prompt_passwords() {
  local first second
  while true; do
    printf 'Dashboard password (input hidden): ' >/dev/tty
    IFS= read -r -s first </dev/tty
    printf '\nRepeat dashboard password: ' >/dev/tty
    IFS= read -r -s second </dev/tty
    printf '\n' >/dev/tty
    if [[ "$first" != "$second" ]]; then
      printf 'Passwords did not match. Try again.\n' >/dev/tty
      continue
    fi
    if (( ${#first} < 8 )); then
      printf 'Password must be at least 8 characters.\n' >/dev/tty
      continue
    fi
    if (( ${#first} < 12 )); then
      warn 'Passwords under 12 characters are accepted but strongly discouraged.'
    fi
    ADMIN_PASSWORD_INPUT="$first"
    return
  done
}

wait_for_health() {
  local attempt
  for attempt in {1..30}; do
    if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3000/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

rollback_app() {
  local failed_release env_restore service_restore
  [[ -n "$rollback_release" && -d "$rollback_release" ]] || return 1
  [[ -f "$previous_env_snapshot" && -f "$previous_service_snapshot" ]] || return 1
  failed_release="/opt/for-you.failed.$(date -u +%Y%m%dT%H%M%SZ)"
  systemctl stop "$APP_NAME" >/dev/null 2>&1 || true
  mv -- "$APP_DIR" "$failed_release" || return 1
  mv -- "$rollback_release" "$APP_DIR" || return 1
  rollback_release=""

  env_restore="$(mktemp /etc/for-you.env.restore.XXXXXX)" || return 1
  service_restore="$(mktemp /etc/systemd/system/for-you.service.restore.XXXXXX)" || return 1
  cp -p -- "$previous_env_snapshot" "$env_restore" || return 1
  cp -p -- "$previous_service_snapshot" "$service_restore" || return 1
  mv -f -- "$env_restore" "$ENV_FILE" || return 1
  mv -f -- "$service_restore" "$SERVICE_FILE" || return 1
  systemctl daemon-reload || return 1
  systemctl start "$APP_NAME" || return 1
  wait_for_health || return 1
  warn "New release failed health checks; restored and verified the prior code, environment, and service unit. Failed code remains at $failed_release."
}

printf 'For You Ubuntu EC2 deployer\n'
printf 'This script installs system packages, publishes reviewed code, and requires trusted HTTPS.\n'
printf 'AWS security groups are outside this script: allow inbound 80/443, restrict SSH/22, and never expose 3000.\n\n'

mode=""
while [[ "$mode" != "domain" && "$mode" != "public-ip" ]]; do
  mode="$(prompt_value 'Deployment mode (domain/public-ip): ')"
done

if [[ "$mode" == "domain" ]]; then
  while true; do
    target="$(prompt_value 'Public hostname (for example, invite.example.com): ')"
    if valid_hostname "$target"; then break; fi
    printf 'Enter a valid fully qualified hostname without a scheme or path.\n' >/dev/tty
  done
else
  detected_ip="$(get_public_ipv4 || true)"
  if [[ -n "$detected_ip" ]] && confirm "AWS IMDSv2 detected public IPv4 $detected_ip. Use it?"; then
    target="$detected_ip"
  else
    while true; do
      target="$(prompt_value 'Public IPv4 address: ')"
      if valid_public_ipv4 "$target"; then break; fi
      printf 'Enter a valid public IPv4 address (not a private or link-local address).\n' >/dev/tty
    done
  fi
fi
certificate_email="$(prompt_email)"

log 'Installing Ubuntu packages and Node.js 22'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl ca-certificates gnupg nginx ufw snapd
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
if [[ "$(node --version)" != v22.* ]]; then
  fatal 'Node.js 22 installation could not be verified.'
fi
systemctl enable --now snapd nginx
snap install core >/dev/null 2>&1 || snap refresh core
snap install certbot --classic >/dev/null 2>&1 || snap refresh certbot
if [[ ! -e /usr/bin/certbot ]]; then ln -s /snap/bin/certbot /usr/bin/certbot; fi
certbot --version

log 'Applying host firewall rules'
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw deny 3000/tcp
ufw --force enable
printf 'AWS reminder: security group inbound 80/443; SSH only from trusted addresses; never 3000.\n'

log 'Cloning and checking the requested release'
staging_dir="$(mktemp -d /root/for-you-deploy.XXXXXX)"
if [[ -n "$REPO_REF" ]]; then
  git clone --filter=blob:none --no-checkout -- "$REPO_URL" "$staging_dir/repository"
  git -C "$staging_dir/repository" fetch --depth 1 origin "$REPO_REF"
  git -C "$staging_dir/repository" checkout --detach FETCH_HEAD
else
  git clone --depth 1 -- "$REPO_URL" "$staging_dir/repository"
fi
release_commit="$(git -C "$staging_dir/repository" rev-parse HEAD)"
printf 'Deploying commit: %s\n' "$release_commit"
(
  cd "$staging_dir/repository"
  npm run check
  node scripts/integration-check.js
)

log 'Creating the locked service identity and persistent directories'
if ! id "$APP_NAME" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_NAME"
fi
usermod --lock --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_NAME"
install -d -m 0700 -o "$APP_NAME" -g "$APP_NAME" "$DATA_DIR"
install -d -m 0755 -o root -g root "$ACME_ROOT"
if [[ -e "$DATA_DIR/responses.jsonl" ]]; then
  chown "$APP_NAME:$APP_NAME" "$DATA_DIR/responses.jsonl"
  chmod 0600 "$DATA_DIR/responses.jsonl"
fi
if [[ -e "$DATA_DIR/background-music.mp3" ]]; then
  chown "$APP_NAME:$APP_NAME" "$DATA_DIR/background-music.mp3"
  chmod 0600 "$DATA_DIR/background-music.mp3"
fi

log 'Preparing an atomic, root-owned application release'
new_release="/opt/for-you.new.$$"
rm -rf -- "$new_release"
install -d -m 0555 -o root -g root "$new_release"
tar -C "$staging_dir/repository" --exclude=.git -cf - . | tar -C "$new_release" -xf -
chown -R root:root "$new_release"
find "$new_release" -type d -exec chmod 0555 {} +
find "$new_release" -type f -exec chmod 0444 {} +

if [[ -f "$ENV_FILE" ]]; then
  previous_env_snapshot="$staging_dir/previous-for-you.env"
  cp -p -- "$ENV_FILE" "$previous_env_snapshot"
fi
if [[ -f "$SERVICE_FILE" ]]; then
  previous_service_snapshot="$staging_dir/previous-for-you.service"
  cp -p -- "$SERVICE_FILE" "$previous_service_snapshot"
fi

cat >"$SERVICE_FILE" <<'UNIT'
[Unit]
Description=For You romantic invitation
After=network-online.target
Wants=network-online.target

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
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
ProtectProc=invisible
ProcSubset=pid
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=/var/lib/for-you

[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "$SERVICE_FILE"

log 'Installing fail-closed nginx ACME/TLS site'
write_nginx_site
ln -sfn "$NGINX_SITE" "$NGINX_LINK"
if [[ -L /etc/nginx/sites-enabled/default ]]; then rm -- /etc/nginx/sites-enabled/default; fi
site_configured=1
reload_nginx

log 'Configuring optional user-supplied music'
audio_source="$(prompt_value 'Existing licensed MP3 path on this EC2 host (blank keeps existing/skips): ')"
if [[ -n "$audio_source" ]]; then
  if [[ ! -f "$audio_source" || -L "$audio_source" || "${audio_source,,}" != *.mp3 ]]; then
    fatal 'Audio must be a regular, non-symlink .mp3 file.'
  fi
  audio_size="$(stat -c %s -- "$audio_source")"
  if (( audio_size <= 0 || audio_size > MAX_AUDIO_BYTES )); then
    fatal 'Audio must be non-empty and no larger than 15 MiB.'
  fi
  audio_temp="$(mktemp "$DATA_DIR/background-music.mp3.tmp.XXXXXX")"
  cp -- "$audio_source" "$audio_temp"
  chown "$APP_NAME:$APP_NAME" "$audio_temp"
  chmod 0600 "$audio_temp"
  mv -f -- "$audio_temp" "$DATA_DIR/background-music.mp3"
  printf 'Copied the supplied local MP3; this script never downloads music.\n'
fi

log 'Collecting dashboard credentials securely'
admin_user="$(prompt_value 'Dashboard username [shreyansh]: ')"
admin_user="${admin_user:-shreyansh}"
if [[ ! "$admin_user" =~ ^[A-Za-z0-9._-]+$ || "$admin_user" == *:* ]]; then
  fatal 'Username may contain only letters, numbers, dot, underscore, and hyphen (no colon).'
fi
prompt_passwords
admin_password_base64="$(printf '%s' "$ADMIN_PASSWORD_INPUT" | base64 | tr -d '\n')"
unset ADMIN_PASSWORD_INPUT

env_temp="$(mktemp /etc/for-you.env.tmp.XXXXXX)"
{
  printf 'HOST=127.0.0.1\n'
  printf 'PORT=3000\n'
  printf 'RESPONSE_FILE=/var/lib/for-you/responses.jsonl\n'
  printf 'TRUST_PROXY=loopback\n'
  printf 'ADMIN_USER=%s\n' "$admin_user"
  printf 'ADMIN_PASSWORD_BASE64=%s\n' "$admin_password_base64"
  if [[ -f "$DATA_DIR/background-music.mp3" && ! -L "$DATA_DIR/background-music.mp3" ]]; then
    printf 'BACKGROUND_AUDIO_FILE=/var/lib/for-you/background-music.mp3\n'
  fi
} >"$env_temp"
chmod 0600 "$env_temp"
chown root:root "$env_temp"
mv -f -- "$env_temp" "$ENV_FILE"
unset admin_password_base64

log 'Promoting the release and starting the service'
if [[ -d "$APP_DIR" ]]; then
  rollback_release="/opt/for-you.rollback.$(date -u +%Y%m%dT%H%M%SZ)"
  mv -- "$APP_DIR" "$rollback_release"
fi
mv -- "$new_release" "$APP_DIR"
new_release=""
systemctl daemon-reload
systemctl enable "$APP_NAME"
systemctl restart "$APP_NAME"
if ! wait_for_health; then
  if rollback_app; then
    fatal 'The new release failed its loopback health check; the prior runtime was restored and verified.'
  fi
  fatal 'The new release failed its loopback health check and automatic recovery could not be verified.'
fi
printf 'Loopback application health check passed.\n'

install -d -m 0755 -o root -g root "$(dirname "$RENEW_HOOK")"
cat >"$RENEW_HOOK" <<'HOOK'
#!/usr/bin/env bash
set -Eeuo pipefail
/usr/sbin/nginx -t
/bin/systemctl reload nginx
HOOK
chmod 0755 "$RENEW_HOOK"

if [[ "$mode" == "domain" ]]; then
  log 'Requesting and installing the domain certificate'
  certbot --nginx --non-interactive --agree-tos --email "$certificate_email" --redirect --cert-name "$target" -d "$target"
  write_nginx_site
  reload_nginx
  public_url="https://$target"
else
  log 'Requesting the official short-lived IP address certificate'
  certbot_version="$(certbot --version 2>&1 | awk '{print $2}')"
  if ! dpkg --compare-versions "$certbot_version" ge 5.4; then
    fatal "Public-IP mode requires Certbot 5.4 or newer; found $certbot_version."
  fi
  certbot certonly --non-interactive --agree-tos --email "$certificate_email" \
    --preferred-profile shortlived \
    --webroot \
    --webroot-path "$ACME_ROOT" \
    --ip-address "$target"

  write_nginx_site
  reload_nginx
  public_url="https://$target"
fi

log 'Verifying trusted public HTTPS'
curl --fail --silent --show-error --max-time 20 "$public_url/health" >/dev/null
tls_ready=1

printf '\nDeployment complete.\n'
printf 'Attendee URL: %s/\n' "$public_url"
printf 'Private response URL: %s/response\n' "$public_url"
printf 'Credentials were stored Base64-encoded in %s (root:root, mode 600); Base64 is encoding, not encryption.\n' "$ENV_FILE"
printf 'Persistent responses and optional music remain in %s across reruns.\n' "$DATA_DIR"
if [[ -n "$rollback_release" ]]; then
  printf 'Previous application release retained at: %s\n' "$rollback_release"
fi
printf 'AWS security group reminder: inbound 80/443, restricted SSH/22, never port 3000.\n'
