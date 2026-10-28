#!/usr/bin/env bash
# Opens, updates or closes the "Daily ingest is failing" issue.
#   ingest-issue.sh fail   after a failed run (reads ./ingest.log)
#   ingest-issue.sh ok     after a successful run
# Needs GH_TOKEN and RUN_URL. The repository is public, so the log excerpt is
# scrubbed of database URLs before it is posted.
set -euo pipefail

TITLE="Daily ingest is failing"
LABEL="ingest-failure"
gh label create "$LABEL" --color B60205 --description "Opened by the PSX ingest workflow" >/dev/null 2>&1 || true

open_issue=$(gh issue list --label "$LABEL" --state open --limit 1 --json number --jq '.[0].number // empty')

if [ "${1:-}" = "ok" ]; then
  if [ -n "$open_issue" ]; then
    gh issue close "$open_issue" --comment "Fixed: the ingest succeeded again. $RUN_URL"
  fi
  exit 0
fi

# From the first error line on (or the last lines if none), without stack frames.
log=$(cat ingest.log 2>/dev/null || echo "(no log captured)")
first=$(printf '%s\n' "$log" | grep -nE -m1 'failed|Error|error' | cut -d: -f1 || true)
excerpt=$(printf '%s\n' "$log" | tail -n +"${first:-1}" \
  | sed -E 's#(libsql|https?|wss?)://[^ )"]*turso[^ )"]*#\1://***#g' \
  | grep -vE '^\s+at ' | head -n 30)

# The most useful single line: Turso's BLOCKED message, else the first error.
reason=$(printf '%s\n' "$excerpt" | grep -m1 -oE 'BLOCKED: [^]]*' || true)
[ -n "$reason" ] || reason=$(printf '%s\n' "$excerpt" | grep -m1 -E 'failed' | cut -c1-200 || true)

body=$(cat <<EOF
The scheduled PSX ingest failed. **Reason:** ${reason:-see the log below}

Latest failed run: $RUN_URL
Updated: $(date -u '+%Y-%m-%d %H:%M UTC')

\`\`\`
$excerpt
\`\`\`

This issue closes itself after the next successful run.
EOF
)

if [ -n "$open_issue" ]; then
  # Edit, don't comment: one notification per outage, not four a day.
  gh issue edit "$open_issue" --body "$body"
else
  gh issue create --title "$TITLE" --label "$LABEL" --body "$body"
fi
