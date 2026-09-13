# Status

Where this repo has got to, and what is still unknown. Kept separate from the README
so the README can stay about what the thing _is_.

Last updated 2026-09-12.

## Done

1. **`mcp/ask-user` relocated here** as a standalone, self-contained folder, with its
   own README and a smoke test that drives it as a real MCP client over stdio.
2. **Copilot's on-disk conventions established** for skills, instructions, MCP and
   hooks, offline, by interrogating the bundled CLI. Written up in
   [docs/copilot-conventions.md](docs/copilot-conventions.md).
3. **`bin/install` built**, with [tests](bin/install-test.mjs) that drive the real
   script against scratch directories and assert on the filesystem it produces.
   Smaller than planned, because Copilot CLI reads `CLAUDE.md` and `.claude/skills/`
   natively — VS Code is the only target needing real translation.
4. **First assets ported** into neutral form: `skills/pr/` and
   `instructions/ask-before-diverging.md`. Meeting real assets found three installer
   bugs, which is what it was for — dropped frontmatter keys, gratuitous re-quoting
   that silently defeated symlinking, and a `--dry-run` that did not predict its own
   refusals.

## Open questions

Every one of these needs an **authenticated session**. The CLI checks auth before it
loads agents or spawns MCP servers, so none of them can be settled offline the way
the rest of the conventions were. `/env` inside a session answers most of them at
once.

1. **What Copilot CLI's built-in `ask_user` tool actually renders.** Free text, or
   real multiple choice? This decides whether [`mcp/ask-user`](mcp/ask-user/README.md)
   has any job on the CLI and desktop app, or is only useful in VS Code agent mode.
   Ask a question that forces the tool and look at what appears.
2. **Whether MCP elicitation works in the CLI and desktop app.** Register `ask-user`
   and read its stderr, which logs which path it took at startup. The server degrades
   to plain text either way, so nothing breaks while this is unknown.
3. **The personal agents directory.** `.github/agents/` is confirmed for projects.
   `~/.copilot/agents/` is the obvious guess by symmetry with skills, but no offline
   probe discovered it, so the installer writes nothing there rather than guessing.
   `/agent` or `/env` will show it.
4. **Whether a workspace `.mcp.json` is loaded by a session.** `copilot mcp list`
   never reports one, under any key or location. `/env` or `/mcp` in a session would
   say whether that is a list-scope quirk or real gating. Low stakes — user-level
   registration is the plan regardless.
5. **Where a repo-level `settings.json` lives.** `copilot help config` says hooks in
   "repo `settings.json`" act as repo-level hooks, without saying where that file is.
   `/settings --repo` will reveal it.

## Next

Settle question 1 first — it is the only one that could make part of this repo
redundant, and everything else is cheap by comparison. Then register `ask-user` at
user level on whichever surfaces still need it and verify end to end.

After that, the remaining work is content rather than plumbing: porting more assets
into neutral form now that the installer can carry them.

## Node version, and one trap

`engines` says **>=22**, which is a support decision: 22 is Maintenance LTS and 24 is
Active LTS, while 18 and 20 are both end-of-life. The _technical_ floor is lower —
tested passing on 18 and 20, and failing only on 16.

What fails on 16 is worth knowing before anyone tidies it: `bin/install` is
deliberately extensionless so it reads as a command, and **extensionless ESM entry
points under `"type": "module"` are unsupported before Node 18**, which errors with
`ERR_UNKNOWN_FILE_EXTENSION`. So three things are load-bearing together — the missing
extension, `"type": "module"` in `package.json`, and the Node floor. Renaming the file
to `bin/install.js` would drop the floor to Node 12 at the cost of the command-like
name; that is a fair trade if it ever matters, but it should be a decision rather than
an accident. `mcp/ask-user/server.mjs` is unaffected, and passes on 16.

## Known rough edges

- **Prompt argument syntax is not translated.** Claude Code's `$ARGUMENTS`/`$1` and
  VS Code's `${input:name}` pass through as written. A prompt needing arguments on
  both surfaces is currently a manual job.
- **Chat modes have no neutral form.** `.github/chatmodes/*.chatmode.md` is a real
  Copilot convention with no source folder here yet.
- **VS Code user-profile paths are unverified**, so `bin/install personal` covers
  Claude Code and Copilot only, and says so in its output.
- **The `ask-user` server is unproven against a real Copilot host.** Its smoke test
  exercises the wire protocol thoroughly, but "a client that advertises elicitation
  renders this the way we expect" has not been observed once.
