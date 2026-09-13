# dotai

Dotfiles, but for AI tooling.

A rule you want every project to follow. A skill worth having everywhere. A prompt you
keep re-typing. These get hand-copied from one project to the next — and then copied
_again_ per tool, because Claude Code, GitHub Copilot and VS Code support the same
handful of ideas under different filenames in different folders. One instruction ends
up living in `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` and
`.github/instructions/`, across a dozen repositories, drifting apart from itself
immediately.

This repo stores each asset **once**, in a neutral form. `bin/install` then puts it
wherever a given project and a given tool expect to find it.

So the reuse runs along two axes: write something here, and it is available in every
project you work in, on whichever tool you are using there — Claude Code, Copilot CLI,
the Copilot desktop app, or VS Code agent mode.

**If you only read one thing here, make it
[docs/copilot-conventions.md](docs/copilot-conventions.md).** GitHub documents that
Copilot supports skills, agents, instructions and hooks, but not which directories it
actually reads them from. That page is the answer, verified against the CLI binary
rather than the docs. Most usefully: **Copilot CLI reads `CLAUDE.md` and
`.claude/skills/` natively**, so for those two asset kinds a single copy serves both
tools and there is nothing to translate at all.

## Quickstart

Needs **Node 22 or newer** (`.nvmrc` pins 24, the current LTS — `nvm use` picks it
up). Nothing else: nothing is installed globally, there is no build step, and the
installer, the MCP server and their tests all run on Node alone with no runtime
dependencies.

```bash
git clone <this repo> ~/dotai && cd ~/dotai
bin/install list        # what exists, and where each thing would go
```

`--dry-run` works on every command below and prints the exact plan — refusals
included — while changing nothing. Reach for it first; it is the cheapest way to see
what a command intends.

## Step 1 — set up your machine, once

Run these from the repo. They are independent, so either can be skipped.

**Register the MCP servers.** These are _launched_ assets: the host runs them in
place, so the code stays here and only a registration is installed.

```bash
bin/install mcp
```

> This shells out to `copilot mcp add`, so it needs `copilot` on your `PATH`. The
> desktop app bundles a CLI rather than installing one, so a machine that plainly has
> Copilot can still fail here — the installer will tell you where the bundled binary
> is. Add it to your `PATH`, or register by hand as
> [mcp/ask-user/README.md](mcp/ask-user/README.md) describes.

**Link your personal assets** into `~/.claude/` and `~/.copilot/`, making them
available in every project without any per-project step:

```bash
bin/install personal --dry-run
bin/install personal
```

Then confirm the tools actually see them — the installer reporting success only means
files landed, not that anything read them:

```bash
ls -l ~/.claude/skills        # symlinks pointing back at this repo
copilot skill list            # yours appear under "Personal skills"
copilot instruction list      # ~/.copilot/copilot-instructions.md under "Personal instructions"
```

In a Copilot session, `/env` lists everything loaded — instructions, skills, agents,
MCP servers, hooks — which is the fastest single check.

## Step 2 — add it to a project, new or existing

Personal assets already cover you everywhere. Do this for anything the **project
itself** must carry, so CI runners and cloud agents see it too:

```bash
bin/install project ../some-repo --dry-run   # read this before the real run
bin/install project ../some-repo
```

With the assets currently in here, that writes:

| File                              | What it is                                                 |
| --------------------------------- | ---------------------------------------------------------- |
| `.claude/skills/pr/`              | the skill — one copy, read by both Claude Code and Copilot |
| `AGENTS.md`                       | always-on rules, inside a `<!-- dotai:begin -->` block     |
| `CLAUDE.md`                       | generated pointer, `@AGENTS.md`                            |
| `.github/copilot-instructions.md` | generated pointer, for every Copilot surface               |

Commit all of it. That is the point — the files have to be in the repo for anything
that only gets a checkout of it to find them.

**On an existing project, expect refusals on the first run.** Anything already there
without a `dotai:generated` marker is left alone and reported, because it might be
yours. Read the list, then re-run with `--force` for the ones you want replaced. After
that they carry the marker and every later run is silent and idempotent.

`AGENTS.md` is the exception and never needs `--force`: only the managed block is
touched, so whatever the project wrote around it survives untouched.

Narrow the scope when you only want part of it:

```bash
bin/install project ../some-repo --only pr              # just that asset
bin/install project ../some-repo --targets copilot      # skip the Claude Code dialect
bin/install project ../some-repo --template templates/base.md   # seed an AGENTS.md
```

Verify from inside the project:

```bash
cd ../some-repo
copilot instruction list      # AGENTS.md, CLAUDE.md and .github/copilot-instructions.md
copilot skill list            # the skill under "Project skills"
```

## Step 3 — living with it

**Editing an asset** takes effect differently by scope. Personal assets are symlinks,
so a change here is live immediately with no command to run. Projects hold copies, so
re-run `bin/install project` there — re-running is idempotent and reports
`already current` for anything unchanged.

**Adding your own asset** means creating a file in one of the source folders. See
**[docs/asset-format.md](docs/asset-format.md)** for the frontmatter each kind takes
and, more importantly, where each one lands — in particular, adding `applyTo` to an
instruction fragment changes it from an always-on rule into a scoped file.

**Anything the installer will not do** is printed under "Not installed, by design" on
every run, with the reason. Those are places a target has no convention, or where the
convention is still unverified — see [STATUS.md](STATUS.md).

## Working on this repo

Two test suites, no framework. Both drive the real thing — the installer as a
subprocess against scratch directories, the MCP server as a client over stdio — and
assert on what it actually produced:

```bash
npm test                             # both
node bin/install-test.mjs            # just the installer's
node mcp/ask-user/smoke-test.mjs     # just the MCP server's
```

Prettier is the sole devDependency, for formatting:

```bash
npm install
npm run format        # or format:check
```

It covers the code and the docs. The asset folders are in `.prettierignore` on
purpose: their bytes are model-facing content rather than a style choice, and that
file explains the reasoning.

### Editor setup

`.editorconfig` is the cross-editor baseline — UTF-8, LF, two-space indent, a 100
column guide — and its values match `.prettierrc.yaml` deliberately, since Prettier reads
that file too and a disagreement would only confuse. JetBrains IDEs and most editors
honour it natively; VS Code needs the EditorConfig extension.

**VS Code** needs nothing beyond the Prettier extension: `.vscode/settings.json` sets
format-on-save and the default formatter, and both are in `.vscode/extensions.json`
as recommendations. The one entry worth knowing about is
`files.associations: { "**/bin/install": "javascript" }` — the file is deliberately
extensionless so it reads as a command, which leaves VS Code with no language to
infer, and the Prettier extension picks its parser from the language id. Without that
line the main source file gets no highlighting and is silently never formatted. It is
the editor-side counterpart to the `overrides` entry in `.prettierrc.yaml`.

**JetBrains** (WebStorm, IntelliJ) auto-detects `.prettierrc.yaml` and the local `prettier`
package. Turn on _Settings → Languages & Frameworks → JavaScript → Prettier → Run on
save_. `.idea/` is gitignored as machine state; if you would rather commit the
setting, un-ignore `.idea/prettier.xml` on its own.

**Anything else** — Zed, Neovim, Sublime — will pick up `.prettierrc.yaml` through its own
Prettier integration, and `.editorconfig` covers indentation and line endings
regardless. Since `.prettierignore` does the real work of protecting the assets, no
editor needs to be told about that separately.

## Layout

```
skills/<name>/SKILL.md   skill folders
instructions/<name>.md   rule fragments; always-on, or scoped by applyTo
prompts/<name>.md        reusable prompts
agents/<name>.md         custom agent definitions
hooks/<name>.json        hook definitions
mcp/<name>/              MCP servers, launched in place
templates/base.md        starter AGENTS.md for a project that has none
bin/install              emits the dialects
docs/                    the reference material
```

Every source folder is present, so the shape of the repo is visible even where nothing
lives yet — the empty ones hold a `.gitkeep`, which discovery ignores along with any
other dotfile.

What is here so far: [`mcp/ask-user/`](mcp/ask-user/README.md), an MCP server that
asks the user a multiple-choice clarifying question; `skills/pr/`, a PR write-up
skill; and `instructions/ask-before-diverging.md`, a rule about asking instead of
guessing. [STATUS.md](STATUS.md) tracks what is done and what is still unknown.

## The governing distinction

Everything about the design follows from one split in how tools find things:

- **Launched assets** — MCP servers. The host runs a command, so the code can live
  anywhere on disk. Register once at user level and it is ambient in every project.
- **Present assets** — prompts, chat modes, instructions, agents, skills, hooks.
  Tools discover these by scanning conventional folders, and there is no way to point
  them at a file elsewhere. If it isn't in the folder, it doesn't exist.

So this repo is a **source of truth you distribute from**, not a dependency you
reference. That is a property of how the tools work, not a choice.

## Why copies for projects, symlinks for you

**Personal assets are symlinked.** `bin/install personal` links them into
`~/.claude/` and `~/.copilot/`, so editing a file here changes behaviour everywhere
immediately, with no sync step to forget. The paths are derived from wherever you
cloned the repo, so this works without configuration.

**Project assets are copied and committed.** This is the part people push back on, so
the reasoning: CI runners and cloud coding agents get a checkout of _that one repo_.
A sibling clone of this one is not there. Something could be fetched over the network
at build time, but that trades a reproducible checkout for a moving dependency in
every build, and the failure mode is a build that behaves differently on Tuesday.
Committing the file is boring and correct.

Every copy is marked, so the next run knows it owns it:

```
<!-- dotai:generated from skills/pr/SKILL.md — do not edit; run bin/install to regenerate -->
```

**Publishing to npm is possible and deliberately not done.** Since present assets
have to end up at exact paths inside a consumer repo, a package would still need a
postinstall step that copies files into place — which is `bin/install` with extra
publishing overhead. Worth revisiting if more than one person is using this.

## The four rules the installer follows

1. **Symlink only when nothing was rewritten.** A personal asset is linked only when
   the emitted file is byte-identical to the source. If a dialect needed different
   frontmatter, it becomes a real file, because a symlink would misrepresent where the
   content came from. This is why the neutral frontmatter is kept close to Copilot's,
   and why the YAML writer re-quotes only what a parser would genuinely misread.
2. **Never clobber someone's writing.** A file without the generated marker is left
   alone and reported, and `--force` is the only way past it. Composed instruction
   files are edited through a `<!-- dotai:begin -->` block, so a project's own policy
   survives around it. Re-running changes nothing, which the tests assert.
3. **One copy where one copy will do.** Two targets resolving to the same folder are
   deduplicated — `.claude/skills/` is the only skill copy a project needs, because
   Copilot reads it natively.
4. **An always-on rule is not a scoped rule.** A fragment with `applyTo` becomes a
   scoped instruction file. One without is composed into the always-on file each tool
   reads. Never both, or Copilot gets the same instruction twice.

Where a target has no convention, or where the convention is still unverified, the
installer prints it under **"Not installed, by design"** on every run rather than
failing quietly. Keeping the gaps visible is the point — it is how an unknown stays
an unknown instead of hardening into folklore.

## Reference

- **[docs/copilot-conventions.md](docs/copilot-conventions.md)** — where Copilot looks
  for skills, instructions, MCP servers, agents and hooks, and how to re-derive it.
- **[docs/asset-format.md](docs/asset-format.md)** — how to write an asset, and where
  each kind ends up.
- **[mcp/ask-user/README.md](mcp/ask-user/README.md)** — the MCP server, its design,
  and how MCP elicitation constrains it.
- **[STATUS.md](STATUS.md)** — what is done, what is unknown, and the rough edges.

## Licence

MIT — see [LICENSE](LICENSE).
