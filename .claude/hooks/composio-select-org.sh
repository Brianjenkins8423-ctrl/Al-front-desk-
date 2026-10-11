#!/usr/bin/env bash
# Select the Composio workspace org at the start of every Claude Code session.
# The environment setup script's `composio orgs switch` does not persist into
# the session, so ~/.composio/user_data.json starts with "org_id": null.
# Never blocks or fails the session; problems are reported on stderr only.

ORG_ID="ok_qRGzbsCTBDaf" # brianjenkins8423_workspace

COMPOSIO="$HOME/.local/bin/composio"
[ -x "$COMPOSIO" ] || COMPOSIO="$(command -v composio 2>/dev/null)"
if [ -z "$COMPOSIO" ]; then
  echo "WARN: Composio CLI not found; org not selected" >&2
  exit 0
fi

if ! timeout 20 "$COMPOSIO" orgs switch --org-id "$ORG_ID" </dev/null >/dev/null 2>&1; then
  echo "WARN: Composio org switch to $ORG_ID failed" >&2
fi
exit 0
