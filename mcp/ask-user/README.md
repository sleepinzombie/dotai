# ask-user

An MCP server with one tool, `ask_user_question`, that asks the user a
multiple-choice clarifying question and blocks until they answer.

It exists because GitHub Copilot has no equivalent of Claude Code's built-in
`AskUserQuestion`. The nearest extension point is MCP **elicitation**: a server
can send `elicitation/create` mid-tool-call and the host renders the form. So the
model calls a tool, the tool elicits, and the host draws the picker.

> **Check this is still needed before you rely on it.** Copilot CLI turns out to
> ship a built-in `ask_user` tool (`copilot --help`, `--no-ask-user`). If it does
> real multiple choice, this server is only useful in VS Code agent mode. See
> [docs/copilot-conventions.md](../../docs/copilot-conventions.md) for what is known,
> and [STATUS.md](../../STATUS.md) for what isn't.

Zero dependencies, one file, `node server.mjs`. Nothing to install or build.

## What the model sees

```jsonc
{
  "questions": [
    {
      "header": "Surface", // ≤12 chars, the decision's name
      "question": "Which surface should this target?",
      "multiSelect": false, // optional
      "options": [
        { "label": "VS Code (recommended)", "description": "Elicitation is documented there." },
        { "label": "Copilot CLI", "description": "Closest to the current workflow." },
      ],
    },
  ],
}
```

Up to 4 questions per call, 2–4 options each, all rendered in one form. Every
question also gets a free-text field, so "Other" is always available.

## Install

The server is the same everywhere; only registration differs. It is a _launched_
asset — the host runs a command, so the code stays in this repo and every
registration points at an absolute path to `server.mjs`. Register once at user
level and it is ambient in every project.

The simplest way is to let the installer do it, since it works the path out from
wherever this repo actually lives:

```bash
bin/install mcp
```

### Copilot CLI and the Copilot desktop app

Both use `~/.copilot/mcp-config.json`. Let the CLI write it rather than editing it
by hand — the desktop app runs the same bundled binary, so one registration covers
both surfaces. Run this from the repo root and `$PWD` supplies the absolute path:

```bash
copilot mcp add ask-user -- node "$PWD/mcp/ask-user/server.mjs"
```

Confirm with `copilot mcp list`, or `/mcp` inside a session. The file it writes
looks like this — note `"type": "local"`, which is what the CLI itself emits:

```json
{
  "mcpServers": {
    "ask-user": {
      "tools": ["*"],
      "type": "local",
      "command": "node",
      "args": ["<absolute path to>/mcp/ask-user/server.mjs"]
    }
  }
}
```

A workspace `.mcp.json` or `.github/mcp.json` is documented but never showed up in
`copilot mcp list` during testing, so treat user level as the only reliable scope.

### VS Code agent mode

Run the **MCP: Open User Configuration** command and add the server there, so it
applies to every workspace. That file uses a top-level `servers` key rather than
`mcpServers`:

```json
{
  "servers": {
    "ask-user": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute path to>/mcp/ask-user/server.mjs"]
    }
  }
}
```

Reload the window, then check **MCP: List Servers**. Elicitation support here is
documented, so you should get a real form.

A per-workspace `.vscode/mcp.json` uses the same schema and understands
`${workspaceFolder}`, but prefer the user-level file — the point of registering
once is not to repeat this per project.

Note that **Claude Code reads a workspace `.mcp.json`** too, so if you use both tools,
dropping this server into one makes `ask_user_question` appear alongside Claude Code's
native `AskUserQuestion`. Harmless, but a reason to keep registration user-level only.

## Making it actually get used

A registered tool is not a used tool. The behaviour comes from instructions, not
from the tool existing — a project's `AGENTS.md` needs a rule telling the model to
ask before it diverges. The server also ships the same policy as MCP
`instructions`, which supporting hosts inject into context.

If Copilot never asks, that is an instructions problem, not a server problem.

## Graceful degradation

Elicitation support is only documented for VS Code. GitHub's docs describe MCP
for Copilot CLI in terms of tools and say nothing about elicitation either way.

So the server checks the `elicitation` capability at initialize time. If the host
does not advertise it, `ask_user_question` returns the question as text with an
instruction for the model to ask it inline and stop. You get the decision
discipline everywhere and the nice UI where it is supported — check stderr on
startup to see which path you are on:

```
[ask-user-mcp] initialized with <client> — elicitation available
[ask-user-mcp] initialized with <client> — elicitation NOT available, will fall back to text
```

## Shape constraints worth knowing

Elicitation schemas are restricted to a flat object of primitives — string
(formats `email`/`uri`/`date`/`date-time`), number/integer, boolean, and
string-with-`enum`/`enumNames`. No nesting, no arrays of objects, no multi-select
enum. That drives some of the design:

- Per-option descriptions cannot be nested in the schema, so they go into the
  prompt's `message` text instead of rendering as per-row subtitles.
- There is no multi-select enum, so `multiSelect: true` becomes one boolean per
  option.
- There is no "recommended" affordance, so put it in the label text.

Responses come back as `accept` (with `content`), `decline`, or `cancel`; the
server has a distinct instruction to the model for each.

## Test

```bash
node mcp/ask-user/smoke-test.mjs
```

`smoke-test.mjs` drives the server as a real MCP client over stdio — handshake,
`tools/list`, accept/decline/cancel, "Other" free text, the no-elicitation
fallback, and input validation.
