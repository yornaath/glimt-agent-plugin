# Windows counterpart of glimt-auth.sh. Claude Code runs headersHelper through
# cmd.exe on Windows, where `sh` usually isn't on PATH, so mcp.json falls back
# to this script. Reads the bearer token from Glimt's owner-only discovery file.
$file = Join-Path $env:APPDATA 'io.glimtapp.application\mcp-commands\mcp.json'
$token = $null
try { $token = (Get-Content -Raw -LiteralPath $file -ErrorAction Stop | ConvertFrom-Json).token } catch {}
if ($token -notmatch '^[A-Za-z0-9_-]+$') {
  [Console]::Error.WriteLine("Glimt isn't running, or MCP is off in Glimt's settings")
  exit 1
}
[Console]::Out.WriteLine('{"Authorization":"Bearer ' + $token + '"}')
