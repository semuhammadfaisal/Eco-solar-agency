# Production Nginx & HTTPS Reverse Proxy Guide

This guide describes how to deploy the **Solar Business Management System** behind an **Nginx** reverse proxy with **Let's Encrypt SSL/TLS (Certbot)** and **PM2** process management.

---

## 1. Prerequisites

- Linux Server (Ubuntu 22.04 LTS / 24.04 LTS or Debian 12)
- Node.js >= 20.x and npm
- MongoDB >= 6.x / 7.x
- Nginx (`sudo apt install nginx`)
- Certbot with Nginx plugin (`sudo apt install certbot python3-certbot-nginx`)
- Registered Domain Name with DNS A record pointing to server IP (e.g., `solar.example.com`)

---

## 2. Process Management with PM2

Install PM2 globally:
```bash
sudo npm install -g pm2
```

Start the application using the cluster configuration in `ecosystem.config.js`:
```bash
cd /var/www/solar-agency-software
pm2 start ecosystem.config.js --env production
```

Configure PM2 to automatically resurrect on system reboot:
```bash
pm2 startup systemd
# Copy-paste the command printed by the terminal, then:
pm2 save
```

Useful PM2 operational commands:
```bash
pm2 status                     # View running instances and memory
pm2 logs                       # Live tail of combined logs
pm2 reload ecosystem.config.js # Zero-downtime rolling reload
pm2 restart all                # Full restart
```

---

## 3. Nginx Reverse Proxy Configuration

Create a new site configuration file at `/etc/nginx/sites-available/solar-agency.conf`:

```nginx
# Upstream PM2 Cluster
upstream solar_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

# 1. HTTP Server - Redirects all traffic to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name solar.example.com;

    # Let's Encrypt ACME challenge directory
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# 2. HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name solar.example.com;

    # SSL Certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/solar.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/solar.example.com/privkey.pem;

    # Modern TLS Security Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;

    # Security Headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "same-origin" always;

    # Maximum upload size (enables multipart survey photos & warranty documents)
    client_max_body_size 25M;
    client_body_buffer_size 128k;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    # Static Assets Caching (Served directly by Nginx)
    location ~* ^/(css|js|images|fonts|favicons)/ {
        root /var/www/solar-agency-software/public;
        expires 7d;
        add_header Cache-Control "public, no-transform";
        access_log off;
    }

    # Uploads (Served with safe headers)
    location /uploads/ {
        alias /var/www/solar-agency-software/public/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
        add_header X-Content-Type-Options "nosniff";
    }

    # Proxy to Node.js / Express Application
    location / {
        proxy_pass http://solar_backend;
        proxy_http_version 1.1;

        # WebSocket & Keepalive Support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';

        # Real Client IP Forwarding
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for heavy PDF generation & report exports
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;

        proxy_buffering on;
        proxy_buffer_size 8k;
        proxy_buffers 16 8k;
    }
}
```

Enable the site configuration and test:
```bash
sudo ln -s /etc/nginx/sites-available/solar-agency.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 4. Automatic SSL Setup with Certbot

Obtain the free Let's Encrypt certificate:
```bash
sudo certbot --nginx -d solar.example.com
```

Certbot automatically configures auto-renewal. Test the renewal timer:
```bash
sudo certbot renew --dry-run
```

---

## 5. Security & Rate Limiting Hardening Checklist

1. **Proxy Trust Setting**: Ensure `app.set('trust proxy', 1)` is enabled in `app.js` so client IPs and rate limiters evaluate correctly behind Nginx.
2. **Session Cookies**: In production, ensure `cookie: { secure: true, httpOnly: true, sameSite: 'lax' }`.
3. **Database Security**: Never expose MongoDB port `27017` to the public internet. Bind MongoDB to `127.0.0.1` and enable authentication.
4. **Automated Backups**: Verify that `scripts/backup.js` runs via cron and stores encrypted/gzipped archives in `/var/backups` or offsite S3 storage.
