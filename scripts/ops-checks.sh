#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f ".env.local" ]]; then
  echo ".env.local が見つかりません" >&2
  exit 1
fi

# .env.local を現在のシェルに読み込む
set -a; source .env.local; set +a

echo "== players (top5)"
curl -sS --fail-with-body \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/players?select=id,handle_name&or=(is_deleted.is.null,is_deleted.eq.false)&order=created_at.desc&limit=5" | jq .

echo -e "\n== match_details (top5)"
curl -sS --fail-with-body \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/match_details?select=id,match_date,is_tournament,venue,loser_id,loser_name,winner_id,winner_name,tournament_name&order=match_date.desc&limit=5" | jq .

echo -e "\n== latency"
curl -sS -w '\nTIME_TOTAL=%{time_total}s\n' -o /dev/null \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/players?select=id&limit=1"
