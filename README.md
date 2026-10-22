# For You — a tiny romantic invitation

A polished, mobile-first static page for asking someone special on a date. It uses only HTML, CSS, and vanilla JavaScript: no packages, build tools, web fonts, network calls, tracking, forms, or data collection.

## Project structure

```text
for-you/
├── index.html   # Semantic page markup and original inline SVG teddy
├── styles.css   # Responsive visuals, glass effect, and animations
├── script.js    # Personalization, playful No button, and celebration
└── README.md    # Setup, customization, and deployment guide
```

## Customize it

Open `script.js` and edit the three values at the very top:

```js
const PERSONALIZATION = {
  recipientName: "Beautiful",
  senderName: "Your Secret Admirer",
  dateIdea: "a cozy café and something sweet"
};
```

Keep the quotation marks. Plain text and emoji are both fine. The values are inserted as text (not HTML) everywhere they appear. You can also edit the question or supporting copy directly in `index.html`.

## Preview locally

No build is required. You can open `index.html` directly, or run a small local server from this directory for browser behavior closest to production:

```bash
cd /path/to/for-you
python3 -m http.server 8080
```

Then visit `http://localhost:8080`. To stop the server, press `Ctrl+C`.

## Deploy on AWS Linux with nginx

These steps work on an EC2 instance. Before connecting, its security group should allow inbound **TCP 80 (HTTP)** and, if using HTTPS, **TCP 443 (HTTPS)** from `0.0.0.0/0` and `::/0`. Keep **SSH/22** limited to your own trusted IP rather than the whole internet. Confirm any OS firewall also permits 80/443 (commands below).

### 1. Install nginx

**Amazon Linux 2023:**

```bash
sudo dnf update -y
sudo dnf install -y nginx
sudo systemctl enable --now nginx
```

**Ubuntu 22.04/24.04:**

```bash
sudo apt update
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

If UFW is enabled on Ubuntu:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw status
```

Amazon Linux normally relies on the EC2 security group. If you separately enabled `firewalld`, allow web traffic with:

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 2. Copy the site and set safe permissions

Copy this project to the instance with `scp`, `rsync`, or your deployment pipeline, then publish it under `/var/www/for-you`:

```bash
sudo mkdir -p /var/www/for-you
sudo cp -a /path/to/uploaded/for-you/. /var/www/for-you/
sudo chown -R root:root /var/www/for-you
sudo find /var/www/for-you -type d -exec chmod 755 {} \;
sudo find /var/www/for-you -type f -exec chmod 644 {} \;
```

Root ownership and read-only public files reduce accidental edits by the web-server process. Deploy updates with `sudo cp` (or a controlled CI user), then restore these ownership and permission settings.

### 3. Configure nginx

Create `/etc/nginx/conf.d/for-you.conf`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com; # Or use _ before DNS is ready

    root /var/www/for-you;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \\.(?:css|js|svg|png|jpg|jpeg|webp)$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files $uri =404;
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
```

If using only the server IP for now, set `server_name _;`. If the default nginx site conflicts on Ubuntu, disable it:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

Validate before reloading—do not skip this safety check:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx --no-pager
```

Visit `http://YOUR_EC2_PUBLIC_IP` or your domain. If it does not load, verify nginx is running and recheck both the EC2 security group and the host firewall.

### 4. Optional HTTPS with a domain and Certbot

Point your domain's `A`/`AAAA` records to the instance first and wait for DNS to resolve. Ports 80 and 443 must both be reachable so the certificate authority can validate the domain.

**Ubuntu:**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

**Amazon Linux 2023:** Certbot package availability can vary by enabled repositories. First try:

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

If those packages are unavailable, use Certbot's current official installation instructions for your operating system rather than adding an untrusted repository. Certbot updates the nginx configuration and offers an HTTP-to-HTTPS redirect.

Finally, verify automatic renewal and re-check nginx:

```bash
sudo certbot renew --dry-run
sudo nginx -t
sudo systemctl reload nginx
```

For production, keep the OS and nginx patched, use an Elastic IP (or a load balancer) so the address remains stable, and back up your personalized files before replacing the instance.

## Accessibility and behavior

The page uses semantic headings, live status text, visible keyboard focus, 48px touch targets, a `prefers-reduced-motion` mode, and responsive sizing down to 320px. The playful **No** button remains inside its visible action area and can be triggered by pointer, touch, click, or keyboard; **Yes** always remains available. Selecting **Yes** swaps to a celebratory confirmation without sending or storing any information.
