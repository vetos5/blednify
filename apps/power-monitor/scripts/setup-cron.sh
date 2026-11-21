#!/usr/bin/env bash
# Sets up hourly cron to fetch schedule
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

crontab -l 2>/dev/null | grep -v 'fetch-schedule.sh' | {
  cat
  echo "0 * * * * $SCRIPT_DIR/fetch-schedule.sh >> /var/log/power-monitor-cron.log 2>&1"
} | crontab -

echo "Cron job installed. Schedule will be fetched every hour."
