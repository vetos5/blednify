#!/usr/bin/env bash
set -euo pipefail

BOT_URL="${BOT_URL:-http://localhost:3100}"
API_URL="https://api.loe.lviv.ua/api/menus?page=1&type=photo-grafic"

echo "Fetching schedule from LOE API..."
response=$(curl -sf "$API_URL")

# Parse with jq
payload=$(echo "$response" | jq '{
  rawHtml: .[0].menuItems[0].rawHtml,
  imageUrl: ("https://api.loe.lviv.ua" + .[0].menuItems[0].imageUrl),
  mobileImageUrl: ("https://api.loe.lviv.ua" + .[0].menuItems[0].slug),
  tomorrowRawHtml: (.[0].menuItems[2].rawHtml // ""),
  tomorrowImageUrl: (if .[0].menuItems[2].imageUrl then "https://api.loe.lviv.ua" + .[0].menuItems[2].imageUrl else "" end),
  tomorrowMobileImageUrl: (if .[0].menuItems[2].slug then "https://api.loe.lviv.ua" + .[0].menuItems[2].slug else "" end)
}')

echo "Sending schedule to bot..."
curl -sf -X POST "$BOT_URL/webhook/schedule" \
  -H "Content-Type: application/json" \
  -d "$payload"

echo
echo "Done!"
