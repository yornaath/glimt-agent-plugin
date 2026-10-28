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

You don't need to paste a token. The plugin finds Glimt and its token automatically.

## Claude Desktop

Install the plugin from the same marketplace (`yornaath/glimt-agent-plugin`) in Claude Desktop's plugin settings. It connects the same way as in Claude Code, with nothing to configure. Keep Glimt running with MCP turned on.

If you added Glimt to `claude_desktop_config.json` by hand before, remove that entry, or the tools show up twice.

## How it connects

`plugin.json` points `mcpServers` at [`glimt.mcpb`](https://www.glimtapp.io/download/glimt.mcpb), an [MCP Bundle](https://github.com/modelcontextprotocol/mcpb) hosted on glimtapp.io. Claude downloads it and runs the `mcp-stdio-bridge` inside on your computer. The bridge talks stdio to Claude and HTTP to Glimt's server on `127.0.0.1`. It reads the URL and token from Glimt's owner-only discovery file on every reconnect, so restarts, port changes and token rotation need no reconfiguration. It can start before Glimt; the tools appear once Glimt runs.

The bundle exists for Claude Desktop. Desktop treats a plugin's plain HTTP server as a remote connector and reaches it from Anthropic's cloud, which can't see `127.0.0.1`. Stdio servers and bundles run locally. The bundle carries the bridge for macOS (Apple silicon) and Windows. It's built and published from the glimt-app repo (`apps/www/scripts/pack-mcpb.mjs`), and its server name `glimt` gives the tools their `mcp__plugin_glimt-app-agent-plugin_glimt__…` names.

## Structure

```
.claude-plugin/        Claude Code manifest and marketplace (must live here)
integrations/
  claude/              Everything Claude specific: skills, later hooks
    skills/            Agent skills, registered through `skills` in plugin.json
```

Each agent gets its own folder under `integrations/`.

## Claude Code

For installation, see [Quick install](#quick-install-claude-code). To work on the plugin, add your local checkout as the marketplace instead: `/plugin marketplace add <local path>`. To try a locally packed bundle, point `mcpServers` at its path relative to the plugin root (for example `"./glimt.mcpb"`) and run `claude --plugin-dir <checkout> mcp list`.

### Skills

- **custom-visualizations**: writes a JavaScript breathing visualization (2D canvas, three.js, three.js addons or pmndrs postprocessing), checks it with off-screen previews (`preview_custom_visualization` returns snapshots the agent can look at), then installs and selects it in Glimt and fixes it from the runtime errors Glimt reports. It documents the module API and the visualization MCP tools; the tool descriptions themselves stay short and point here. Keep `references/module-api.md` in sync with `CustomVisualizationApi.ts` and `scripts/sandbox/libraries.mjs` in the glimt-app repo. The skill's references also hold a credited shader cookbook (`shader-cookbook.md`), the libraries the sandbox offers (`libraries.md`), a technique chooser (`techniques.md`) and the default Glimt palette (`palette.md`). The palette holds the on-screen colours of glimt-app's default 3D orb, sampled from renders; sample a new render and update it when `Orb3DPalette` changes. Glimt's sandbox test suite (`pnpm test:sandbox` in glimt-app) runs every example and compiles every cookbook snippet from a checkout of this repo next to it.

### Troubleshooting

- **Tools missing:** start Glimt and check MCP is on in its settings. The tools appear on their own once Glimt runs; in Claude Code you can also reconnect from `/mcp`.
- **Claude Desktop says the connector URL is invalid** (an "Add custom connector" dialog with a locked `http://127.0.0.1:43110/mcp`): you have plugin version 0.4 or older, which connected over HTTP. Update the plugin.
