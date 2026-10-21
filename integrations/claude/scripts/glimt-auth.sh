#!/bin/sh
# Claude Code headersHelper for the Glimt MCP server.
# Reads the bearer token from Glimt's owner-only discovery file, which the app
# writes when its MCP server starts and removes when it stops. Runs on every
# connect and after a 401, so token rotation and app restarts are picked up.
id=io.glimtapp.application
case "$(uname -s)" in
  Darwin) dir="$HOME/Library/Application Support/$id" ;;
  MINGW*|MSYS*|CYGWIN*) dir="$APPDATA/$id" ;;
  *) dir="${XDG_DATA_HOME:-$HOME/.local/share}/$id" ;;
esac

token=$(sed -n 's/.*"token": *"\([A-Za-z0-9_-]*\)".*/\1/p' "$dir/mcp-commands/mcp.json" 2>/dev/null)
if [ -z "$token" ]; then
  echo "Glimt isn't running, or MCP is off in Glimt's settings" >&2
  exit 1
fi
printf '{"Authorization":"Bearer %s"}\n' "$token"
