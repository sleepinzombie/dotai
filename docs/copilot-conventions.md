# Where GitHub Copilot looks for things

GitHub documents that Copilot supports custom skills, agents, instructions and
hooks. It is much less forthcoming about _which directories on disk_ those come
from. This page is the answer, established by interrogating the CLI rather than by
reading marketing pages, so it can be re-derived rather than trusted.

Verified **2026-09-12** against **Copilot CLI 1.0.84-4**, the build bundled inside
the **Copilot desktop app 1.1.19**. If any of it has drifted, the "How this was
established" section at the bottom tells you how to check in a couple of minutes.

## The table

| Asset            | Project                                                                                                   | Personal (user level)                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Skills**       | `.github/skills/`, `.agents/skills/`, **`.claude/skills/`** — all three, all equal                        | `~/.copilot/skills/`, `~/.agents/skills/`                                         |
| **Instructions** | `AGENTS.md`, **`CLAUDE.md`**, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | `~/.copilot/copilot-instructions.md`, `~/.copilot/instructions/*.instructions.md` |
| **MCP servers**  | `.mcp.json`, `.github/mcp.json`                                                                           | `~/.copilot/mcp-config.json`                                                      |
| **Agents**       | `.github/agents/`                                                                                         | unconfirmed                                                                       |
| **Hooks**        | `.github/hooks/*.json`                                                                                    | `hooks` key inside the global `config.json`                                       |

The desktop app runs the same bundled CLI binary, so CLI conventions are desktop
conventions. You can see the binary it uses in the app's own log:
`~/Library/Caches/github-copilot-sdk/cli/<version>/copilot` on macOS.

## The findings that surprised us

**Copilot CLI reads `CLAUDE.md` and `.claude/skills/` natively.** Not as a
compatibility shim — both appear as first-class discovered sources, `CLAUDE.md`
alongside `AGENTS.md` in `copilot instruction list`, and `.claude/skills/` alongside
`.github/skills/` in `copilot skill list`. So a single copy of either serves both
tools, and neither needs translating. This is the single most useful thing on this
page: it removes most of the duplication you would otherwise expect to maintain.

**Only `~/.copilot/copilot-instructions.md` is read at the home level.** Tested
`~/.copilot/AGENTS.md`, `~/.copilot/CLAUDE.md`, `~/.copilot/instructions.md` and
`~/.copilot/COPILOT.md` alongside it: none were discovered. The `AGENTS.md`
convention does _not_ apply to your home directory.

**`~/.copilot/instructions/*.instructions.md` works at user level**, and is reported
with type `vscode` — so VS Code's scoped-instruction format, `applyTo` frontmatter
included, is the portable form for personal rules.

**`copilot mcp add` is the way to register a server**, and its output is the
canonical schema. Note it writes `"type": "local"`, not the `"stdio"` that VS Code's
own MCP file wants:

```json
{
  "mcpServers": {
    "ask-user": {
      "tools": ["*"],
      "type": "local",
      "command": "node",
      "args": ["/abs/path/server.mjs"]
    }
  }
}
```

**`copilot mcp list` only ever reports the user config.** A workspace `.mcp.json` or
`.github/mcp.json` never appeared in it — not under `mcpServers`, not under
`servers`, not in either location, not in a fresh repo nor a long-lived one. The
`copilot mcp --help` text claims a Workspace group exists, so this is either a
list-scope limitation or trust gating. Either way, user-level registration is the
only scope confirmed to work end to end. Treat workspace MCP config as unverified.

**Copilot CLI ships a built-in `ask_user` tool.** `copilot --help` documents
`--no-ask-user`: _"Disable the ask_user tool (agent works autonomously without
asking questions)."_ Anyone about to build an MCP server to ask the user clarifying
questions — as [`mcp/ask-user`](../mcp/ask-user/README.md) here does — should check
what that built-in already renders first. What it produces (free text, or real
multiple choice) is still unconfirmed; see [STATUS.md](../STATUS.md).

**MCP elicitation schemas are a flat object of primitives.** String (with formats
`email`/`uri`/`date`/`date-time`), number/integer, boolean, and string-with-`enum`
/`enumNames`. No nesting, no arrays of objects, no multi-select enum. Responses are
`accept` (with `content`), `decline`, or `cancel`. VS Code documents elicitation
support; GitHub's Copilot CLI docs discuss MCP purely in terms of tools and are
silent on it.

**VS Code's own MCP file uses a top-level `servers` key**, with `type: "stdio"`,
`command` and `args`, and interpolates `${workspaceFolder}`. The user-level
equivalent is reached through the **MCP: Open User Configuration** command and uses
the same schema.

## How this was established

None of this needs a running session or an authenticated account. The CLI will tell
you everything if you ask it directly.

```bash
# The bundled binary the desktop app itself drives
CLI=~/Library/Caches/github-copilot-sdk/cli/1.0.84-4/copilot

$CLI skill --help          # names all project and personal skill directories
$CLI mcp --help            # names the user, workspace and plugin config locations
$CLI help config           # every setting, including hooks and disableAllHooks
$CLI instruction list      # what a session in this directory would actually load
$CLI skill list --json     # what it would actually discover, with resolved paths
```

The two commands that end in `list` are the important ones: they report what the CLI
_does_, not what it claims. Use them to check any of this rather than believing the
table above.

To probe safely, point `COPILOT_HOME` at a scratch directory. It relocates the
entire config directory, so you can create candidate files, see which ones get
discovered, and never touch your real state:

```bash
mkdir -p /tmp/probe-home
echo "hello" > /tmp/probe-home/copilot-instructions.md
COPILOT_HOME=/tmp/probe-home $CLI instruction list --json
```

That is exactly how the home-level instruction file was pinned down, and how the
canonical `mcp-config.json` schema was obtained — by letting `copilot mcp add` write
into a throwaway home and reading back what it produced.

Inside a real session, **`/env`** dumps loaded instructions, MCP servers, skills,
agents, hooks, plugins, LSPs and extensions in one shot. It is the fastest way to
settle anything this page marks unconfirmed, and it is the one method that needs to
be logged in.

## A road not taken

For the specific problem of asking the user a multiple-choice question, a VS Code
extension using the Language Model Tool API (`contributes.languageModelTools` plus
`vscode.lm.registerTool`) gives a more faithful UI than MCP elicitation — real
multi-select via `showQuickPick`, per-row detail lines. It was rejected here because
it is VS Code only, needs packaging, and because per the VS Code docs _"a generic
confirmation dialog will always be shown for tools from extensions"_, which adds a
click to every single question. Worth revisiting only if elicitation proves
inadequate in practice.
