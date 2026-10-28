# Glimt agent plugin

Connects coding agents to the [Glimt](https://www.glimtapp.io) desktop app, so they can start breath work sessions, show reminders, manage presets and playlists, and design your own breathing visualizations through Glimt's local MCP server.

## Quick install (Claude Code)

1. Start Glimt and turn on MCP in Glimt's settings.
2. In Claude Code, run:

   ```
   /plugin marketplace add yornaath/glimt-agent-plugin
   /plugin install glimt-app-agent-plugin@glimt
   ```

3. Run `/mcp` and check that `glimt` is connected. Then try asking Claude: *"start a short breathing session"*, or *"make me a calm ocean-wave breathing visualization"*.

You don't need to paste a token. The plugin reads it from Glimt automatically.

## Structure

```
.claude-plugin/        Claude Code manifest and marketplace (must live here)
integrations/
  claude/              Everything Claude specific: MCP config, scripts, skills, later hooks
    skills/            Agent skills, registered through `skills` in plugin.json
```

Each agent gets its own folder under `integrations/`.

## Claude Code

For installation, see [Quick install](#quick-install-claude-code). To work on the plugin, add your local checkout as the marketplace instead: `/plugin marketplace add <local path>`.

The plugin registers the `glimt` MCP server. Its `headersHelper` reads the token from Glimt's discovery file each time it connects, so there's nothing to paste and token rotation needs no reconfiguration.

Claude Code runs `headersHelper` through `sh` on macOS/Linux but through `cmd.exe` on Windows, where `sh` usually isn't on PATH. The command tries `glimt-auth.sh` first and falls back to `glimt-auth.ps1` with `||`, which both shells understand. Keep the two scripts in sync.

### Skills

- **custom-visualizations**: writes a JavaScript breathing visualization (2D canvas, three.js, three.js addons or pmndrs postprocessing), checks it with off-screen previews (`preview_custom_visualization` returns snapshots the agent can look at), then installs and selects it in Glimt and fixes it from the runtime errors Glimt reports. It documents the module API and the visualization MCP tools; the tool descriptions themselves stay short and point here. Keep `references/module-api.md` in sync with `CustomVisualizationApi.ts` and `scripts/sandbox/libraries.mjs` in the glimt-app repo. The skill's references also hold a credited shader cookbook (`shader-cookbook.md`), the libraries the sandbox offers (`libraries.md`), a technique chooser (`techniques.md`) and the default Glimt palette (`palette.md`). The palette holds the on-screen colours of glimt-app's default 3D orb, sampled from renders; sample a new render and update it when `Orb3DPalette` changes. Glimt's sandbox test suite (`pnpm test:sandbox` in glimt-app) runs every example and compiles every cookbook snippet from a checkout of this repo next to it.

## Claude Desktop

In Claude Desktop the plugin adds the skills but can't connect on its own. Desktop treats a plugin's HTTP server as a remote connector and reaches it from Anthropic's cloud, which can't see `http://127.0.0.1`. Desktop connects to servers on your computer only over stdio, so Glimt ships a small stdio bridge (`mcp-stdio-bridge`) for it:

1. Start Glimt and turn on MCP in Glimt's settings.
2. In Glimt's MCP settings, pick **Claude Desktop** and copy the snippet. It launches the bridge bundled with Glimt.
3. In Claude Desktop, open Settings → Developer → Edit Config, add the snippet's entry to `mcpServers` in `claude_desktop_config.json` and restart Claude Desktop.

The bridge finds Glimt by itself and follows restarts and token changes, so there's no token to paste. It can start before Glimt; the tools appear once Glimt runs. The Mac App Store build doesn't include the bridge.

### Troubleshooting

- **Tools missing / server failed:** start Glimt, check MCP is on, then reconnect from `/mcp`. The server can't connect while Glimt isn't running.
- **Claude Desktop says the plugin's connector URL is invalid** (an "Add custom connector" dialog with a locked `http://127.0.0.1:43110/mcp`, telling you to check with whoever provided it): that's the HTTP entry Claude Code uses. Ignore it, and connect through the bridge as described in [Claude Desktop](#claude-desktop).
- **Port taken:** Glimt prefers port 43110 and tries a few after it. If all are taken it picks a random port, which this config can't follow.
