# Writing an asset

Every asset is stored **once**, in a neutral form, in one of the source folders at
the repo root. `bin/install` reads that form and emits whatever dialect each tool
expects. This page is the contract: what to put in a file, and where it ends up.

The neutral frontmatter is deliberately close to Copilot's dialect. That is not
favouritism — when the emitted file is byte-identical to the source, the installer
can symlink it instead of copying, and a symlink means editing the file here is live
everywhere immediately. Every key you add that has to be rewritten costs you that.

## `skills/<name>/SKILL.md`

A folder, containing at minimum `SKILL.md` with a `name` and a `description`. Extra
files alongside it — references, scripts, examples — are copied through untouched.

```markdown
---
name: pr
description: Generate a pull request title, description, and commit message. Use when the user asks for a PR write-up or runs `/pr`.
user-invocable: true
---

# PR Write-up

...
```

**Frontmatter is passed through unchanged**, every key. `SKILL.md` is a genuinely
shared format, and filtering it would drop tool-specific keys that matter —
`user-invocable` is read by Claude Code and ignored by Copilot, which is the correct
outcome for both.

The `description` is not documentation. It is the only thing a model sees when
deciding whether to load the skill, so say when to use it, not just what it is.

| Scope    | Lands in                                                         |
| -------- | ---------------------------------------------------------------- |
| project  | `.claude/skills/<name>/`                                         |
| personal | `~/.claude/skills/<name>`, `~/.copilot/skills/<name>` (symlinks) |

One project copy covers Claude Code _and_ Copilot CLI, because Copilot reads
`.claude/skills/` natively — see [copilot-conventions.md](copilot-conventions.md).

## `instructions/<name>.md`

A rule fragment. **The presence of `applyTo` changes where it goes**, and this is the
one piece of routing that is easy to get wrong.

Without `applyTo`, the fragment is _always-on_, and gets composed into whichever file
each tool reads for always-on rules:

```markdown
## Ask before you diverge

When different readings of a request would lead to materially different work, ask
rather than guess.
```

| Scope    | Composed into                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| project  | `AGENTS.md` (inside a managed block), plus a generated `CLAUDE.md` and `.github/copilot-instructions.md` pointing at it |
| personal | `~/.copilot/copilot-instructions.md` and `~/.claude/CLAUDE.md`, both inside a managed block                             |

With `applyTo`, it is _scoped_ to matching files, and stays a file of its own:

```markdown
---
description: TypeScript rules.
applyTo: "**/*.ts"
---

Never use `any`.
```

| Scope    | Lands in                                         |
| -------- | ------------------------------------------------ |
| project  | `.github/instructions/<name>.instructions.md`    |
| personal | `~/.copilot/instructions/<name>.instructions.md` |

A fragment is never both. Emitting an always-on rule as a scoped file _as well_
would hand Copilot the same instruction twice, and Claude Code has no scoped-rules
format at all, so a fragment with `applyTo` reaches Copilot only.

Start an always-on fragment at heading level `##`. It gets composed into a larger
document, so an `#` would compete with that document's own title.

## `prompts/<name>.md`

A reusable prompt. Keys: `description`, optional `argumentHint`, `model`, `mode`.

```markdown
---
description: Open a PR for this branch.
argumentHint: "[base-branch]"
---

Open a PR.
```

| Target | Lands in                                                       |
| ------ | -------------------------------------------------------------- |
| claude | `.claude/commands/<name>.md`, `argumentHint` → `argument-hint` |
| vscode | `.github/prompts/<name>.prompt.md`, keeping `mode` and `tools` |

**Copilot CLI has no prompt-file convention.** Its reusable unit of instruction is a
skill, so if you want a prompt available there, write it as a skill instead — a
`user-invocable` skill is reachable as `/<name>` anyway, which covers most of what a
prompt was for.

Note that argument syntax is _not_ translated: Claude Code's `$ARGUMENTS` and `$1`
and VS Code's `${input:name}` are left exactly as written. If a prompt needs
arguments on both, that is currently a manual concern.

## `agents/<name>.md`

A custom agent. Keys: `name`, `description`, optional `tools`, `model`.

| Scope    | Lands in                                               |
| -------- | ------------------------------------------------------ |
| project  | `.claude/agents/<name>.md`, `.github/agents/<name>.md` |
| personal | `~/.claude/agents/<name>.md` only                      |

Copilot's personal agents directory is unconfirmed, so nothing is written for it
rather than guessing. See [STATUS.md](../STATUS.md).

## `hooks/<name>.json`

Copied verbatim to `.github/hooks/<name>.json` for a project. JSON cannot carry a
"generated" comment, so the installer instead treats a byte-identical destination as
already-correct — which is what keeps re-runs idempotent for this one.

Personal hooks are **not** installed. They live inside `~/.copilot/config.json`,
which the tools manage themselves, and silently merging into a file another program
owns is a bad trade. Merge those by hand.

## `mcp/<name>/`

An MCP server. Not a "present" asset at all: the host launches it by absolute path,
so the code stays here and only a registration is installed. `bin/install mcp` finds
`mcp/<name>/server.mjs`, works out the absolute path from wherever the repo actually
lives, and runs `copilot mcp add`.

Drop a `register.json` in the folder to override the inferred command:

```json
{ "command": "python3", "args": ["/abs/path/to/server.py"] }
```

## Frontmatter parsing, honestly

`bin/install` implements a small YAML subset on purpose: `key: value`, inline
`[a, b]` lists, and `- item` lists. That covers every asset format in play. If you
find yourself wanting anchors, nested maps or multi-line strings, the neutral form is
drifting into configuration and the answer is probably to put that content in the
body instead.

Values are re-quoted only when a YAML reader would genuinely misread them — a
leading indicator character, an embedded `: ` or ` #`, or something that would come
back as a boolean or number. Anything else is left exactly as you wrote it, so the
file stays symlinkable.

## Checking your work

```bash
bin/install list                        # every asset, and where it would go
bin/install project /tmp/scratch --dry-run   # the exact plan, including refusals
npm test                                # the installer's own tests
```

Note that the asset folders are excluded from Prettier — see `.prettierignore` for
why — so formatting these files is on you. Keep to the conventions of the ones
already there.

`list` reports composed fragments as "composed into ..." rather than naming scoped
destinations, so it is a quick way to confirm you got the `applyTo` decision you
intended.
