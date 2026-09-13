# AGENTS.md

Starter instructions for a project that has none. `bin/install project <dir>` uses
this only when the target has no `AGENTS.md` yet, then appends the managed block —
so everything above that block is yours to edit and will survive later runs.

Copilot CLI reads this file natively, as does anything else honouring the AGENTS.md
convention. A generated `CLAUDE.md` next to it points here with `@AGENTS.md`, so
Claude Code sees the same content without a second copy to keep in step.

## What this project is

One or two sentences. What it does, who uses it, what it is not.

## How to run it

The commands you would want an agent to use rather than guess at: install, dev,
test, lint, typecheck. Name the package manager explicitly.

## Conventions that are not obvious from the code

Only the things a careful newcomer would get wrong. Skip anything a linter already
enforces, and anything derivable by reading two files.

## Project-specific policy

Rules that apply here and nowhere else. Anything you would want in *every* project
belongs in this repo's `instructions/` instead, so it lands in all of them.
