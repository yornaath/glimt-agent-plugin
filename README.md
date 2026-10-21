# Glimt agent plugin

Connects coding agents to the [Glimt](https://www.glimtapp.io) desktop app, so they can start breath work sessions, show reminders and manage presets and playlists through Glimt's local MCP server.

## Quick install (Claude Code)

1. Start Glimt and turn on MCP in Glimt's settings.
2. In Claude Code, run:

   ```
   /plugin marketplace add yornaath/glimt-agent-plugin
   /plugin install glimt-app-agent-plugin@glimt
   ```

3. Run `/mcp` and check that `glimt` is connected. Then try asking Claude: *"start a short breathing session"*.

You don't need to paste a token. The plugin reads it from Glimt automatically.

## Structure

```
.claude-plugin/        Claude Code manifest and marketplace (must live here)
integrations/
  claude/              Everything Claude specific: MCP config, scripts, later hooks and skills
```

Each agent gets its own folder under `integrations/`.

## Claude Code

For installation, see [Quick install](#quick-install-claude-code). To work on the plugin, add your local checkout as the marketplace instead: `/plugin marketplace add <local path>`.

The plugin registers the `glimt` MCP server. Its `headersHelper` reads the token from Glimt's discovery file each time it connects, so there's nothing to paste and token rotation needs no reconfiguration.

Claude Code runs `headersHelper` through `sh` on macOS/Linux but through `cmd.exe` on Windows, where `sh` usually isn't on PATH. The command tries `glimt-auth.sh` first and falls back to `glimt-auth.ps1` with `||`, which both shells understand. Keep the two scripts in sync.

### Troubleshooting

- **Tools missing / server failed:** start Glimt, check MCP is on, then reconnect from `/mcp`. The server can't connect while Glimt isn't running.
- **Port taken:** Glimt prefers port 43110 and tries a few after it. If all are taken it picks a random port, which this config can't follow.
