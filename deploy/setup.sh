#!/bin/bash
# Deploy tg-analyzer on 159.255.37.139
# Usage: bash setup.sh
set -e

REPO_URL="https://github.com/eltempo9999-sketch/tg-analyzer.git"
DEPLOY_DIR="/var/www/tg-analyzer"
ENV_DIR="/etc/tg-analyzer"
SERVICE_NAME="tg-analyzer"

echo "=== tg-analyzer setup ==="

# 1. Install bun if missing
if ! command -v /root/.bun/bin/bun &>/dev/null; then
  echo "[*] Installing bun..."
  curl -fsSL https://bun.sh/install | bash
fi

# 2. Clone or update repo
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "[*] Updating repo..."
  cd "$DEPLOY_DIR"
  git fetch origin
  git reset --hard origin/main
else
  echo "[*] Cloning repo..."
  git clone "$REPO_URL" "$DEPLOY_DIR"
fi

# 3. Install dependencies
echo "[*] Installing dependencies..."
cd "$DEPLOY_DIR"
/root/.bun/bin/bun install --frozen-lockfile

# 4. Create env dir if missing
mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_DIR/analyzer.env" ]; then
  echo "[!] Config not found. Creating template at $ENV_DIR/analyzer.env"
  cp "$DEPLOY_DIR/.env.example" "$ENV_DIR/analyzer.env"
  echo "[!] IMPORTANT: Edit $ENV_DIR/analyzer.env and fill in secrets before starting"
fi

# 5. Install systemd service
echo "[*] Installing systemd service..."
cp "$DEPLOY_DIR/deploy/tg-analyzer.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "=== Done ==="
echo "Next steps:"
echo "  1. Edit $ENV_DIR/analyzer.env (fill TG_ANALYZER_SECRET, TELEGRAM_API_ID/HASH, LLM keys)"
echo "  2. systemctl start $SERVICE_NAME"
echo "  3. systemctl status $SERVICE_NAME"
echo "  4. journalctl -u $SERVICE_NAME -f"
