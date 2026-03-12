# Deployment Guide — Debian VDS (awb.arona.ro)

## Prerequisites
- Debian 11/12 VDS with root/sudo access
- Domain `awb.arona.ro` pointing to the VDS IP (A record)

---

## Step 1: Install System Dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.11 python3.11-venv python3-pip \
    postgresql postgresql-contrib \
    nginx certbot python3-certbot-nginx \
    git curl
```

Install Node.js 20 LTS:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## Step 2: Setup PostgreSQL

```bash
sudo -u postgres psql
```

Inside the PostgreSQL shell:
```sql
CREATE USER awb_user WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE awbprint OWNER awb_user;
GRANT ALL PRIVILEGES ON DATABASE awbprint TO awb_user;
\q
```

---

## Step 3: Clone the Repository

```bash
cd /opt
sudo git clone https://github.com/cata2lin/AWB.git awb-print
sudo chown -R $USER:$USER /opt/awb-print
cd /opt/awb-print
```

---

## Step 4: Setup Backend

```bash
cd /opt/awb-print/backend

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp /opt/awb-print/.env.example .env
nano .env
```

Edit `.env` with your actual values:
```env
FRISBO_API_TOKEN=your_token_here
FRISBO_ORG_TOKENS=[{"name":"store1","token":"token1"}, ...]
DATABASE_URL=postgresql://awb_user:CHANGE_THIS_PASSWORD@localhost:5432/awbprint
PDF_STORAGE_PATH=./storage
```

Test the backend starts:
```bash
source venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8001
# Should show "Uvicorn running on http://127.0.0.1:8001"
# Press Ctrl+C to stop
```

---

## Step 5: Setup Frontend

```bash
cd /opt/awb-print/frontend

# Install dependencies
npm install

# Build for production
npm run build
# Output goes to /opt/awb-print/frontend/dist/
```

---

## Step 6: Create Systemd Service (Backend)

```bash
sudo nano /etc/systemd/system/awb-backend.service
```

Paste:
```ini
[Unit]
Description=AWB Print Manager Backend
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/awb-print/backend
Environment="PATH=/opt/awb-print/backend/venv/bin:/usr/bin"
ExecStart=/opt/awb-print/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable awb-backend
sudo systemctl start awb-backend
sudo systemctl status awb-backend
```

---

## Step 7: Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/awb.arona.ro
```

Paste:
```nginx
server {
    listen 80;
    server_name awb.arona.ro;

    # Frontend — serve built static files
    root /opt/awb-print/frontend/dist;
    index index.html;

    # SPA routing — all non-API, non-file routes → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API — proxy to uvicorn backend
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Increase timeouts for long sync operations
        proxy_read_timeout 300s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;

        # Allow large CSV uploads
        client_max_body_size 50M;
    }

    # Static assets caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/awb.arona.ro /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 8: SSL Certificate (HTTPS)

```bash
sudo certbot --nginx -d awb.arona.ro
# Follow the prompts, select "redirect HTTP to HTTPS"
```

Certbot auto-renews via a systemd timer. Verify:
```bash
sudo certbot renew --dry-run
```

---

## Step 9: Verify Everything

```bash
# Check backend is running
sudo systemctl status awb-backend

# Check nginx
sudo systemctl status nginx

# Test API
curl https://awb.arona.ro/api/health
# Should return: {"status":"healthy","version":"1.0.0"}

# Open in browser
# https://awb.arona.ro
```

---

## Daily Operations

### View backend logs
```bash
sudo journalctl -u awb-backend -f
```

### Restart backend
```bash
sudo systemctl restart awb-backend
```

### Update from GitHub
```bash
cd /opt/awb-print
git pull

# If backend changed:
cd backend
source venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart awb-backend

# If frontend changed:
cd /opt/awb-print/frontend
npm install
npm run build
# No restart needed — nginx serves static files
```

### Database backup
```bash
pg_dump -U awb_user awbprint > /opt/backups/awbprint_$(date +%Y%m%d).sql
```

---

## Port Summary

| Service | Port | Accessible |
|---------|------|-----------|
| **Nginx** | 80/443 | Public (awb.arona.ro) |
| **Backend (uvicorn)** | 8001 | localhost only |
| **PostgreSQL** | 5432 | localhost only |
| **Frontend** | — | Served as static files by nginx |
