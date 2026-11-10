#!/usr/bin/env bash
# Starts local Supabase in a CI job, and tries again when a port is taken.
#
# Now and then the start fails with "failed to bind host port ...: address
# already in use": a connection the runner made earlier still holds one of
# Supabase's ports. By then the images are on the machine, so another try
# takes seconds, where a re-run of the whole pipeline takes minutes. Any
# other failure, a broken migration for one, stops at once.
set -uo pipefail

log="$(mktemp)"
for try in 1 2 3; do
  npm run db:start 2>&1 | tee "$log"
  status="${PIPESTATUS[0]}"
  if [ "$status" -eq 0 ]; then exit 0; fi
  if ! grep -q "address already in use" "$log"; then exit "$status"; fi
  echo "::warning::A local Supabase port was taken on try $try of 3."
  # Which socket holds a port from 55420 to 55429, for the record.
  sudo ss -Htanp | grep -E ':5542[0-9]\s' || echo "No socket holds a port from 55420 to 55429 now."
  npx supabase stop --no-backup || true
  sleep 3
done
exit 1
