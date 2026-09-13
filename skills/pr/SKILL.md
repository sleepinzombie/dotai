---
name: pr
description: Generate a pull request title, description, and commit message for the current changes. The commit message covers the pending commit; the PR title and description cover the whole branch, including commits already made. Use when the user asks for a PR write-up, PR description, commit message, or runs `/pr`.
user-invocable: true
---

# PR Write-up

Generate a commit message for the commit about to be made, plus a pull request
title and description covering the entire branch.

These are two different scopes and must not be conflated:

| Output | Scope |
| --- | --- |
| Commit subject + body | Only the pending, uncommitted changes |
| PR title + description | The whole branch: every commit since the base branch, **plus** the pending changes |

## Steps

### 1. Establish the base branch

Run `git symbolic-ref --short refs/remotes/origin/HEAD` and strip the `origin/`
prefix. Call the result `<base>`.

That ref is unset in plenty of clones, so treat failure as normal rather than an
error. When it fails, take the first of `main`, `master`, `develop`, `dev` that
actually exists, checking each with
`git rev-parse --verify --quiet refs/remotes/origin/<name>` and then
`refs/heads/<name>`. Never assume a name without verifying it — a base branch that
doesn't exist produces a diff for the wrong range, or none at all, and the write-up
that follows will be confidently wrong.

Prefer `origin/<base>` in the commands below. If `origin/<base>` doesn't resolve,
fall back to the local `<base>`.

### 2. Read the pending changes — scope of the commit message

- `git status --short` — staged, unstaged, and untracked files.
- `git diff HEAD` — staged and unstaged changes to tracked files.
- Read any relevant untracked files (new source files, hooks, config) to
  understand their contents.

`git diff HEAD` is deliberate rather than a bare `git diff`, so already-staged
changes are included.

### 3. Read the whole branch — scope of the PR

- `git log --oneline <base>..HEAD` — the commits already on this branch.
- `git merge-base HEAD <base>` — call the result `<merge-base>`.
- `git diff <merge-base>` — the cumulative diff from the base branch to the
  current working tree. This includes both the earlier commits and the pending
  changes, which is exactly the PR's scope.

If `git log <base>..HEAD` is empty, the branch has no commits of its own yet and
the two scopes are identical. Say nothing about it; just produce the output.

### 4. Collect Jira keys, if there are any

Jira keys are **optional**. Plenty of branches have none, and that is a normal
path that produces no Jira output at all — not a problem to report or work
around.

A key matches the pattern `[A-Z]+-[0-9]+` (e.g. `ABC-123`). Gather candidates
from two sources, in this order:

1. The branch name, from `git branch --show-current`.
2. The commit subjects in the `git log --oneline <base>..HEAD` output from step 3.

Deduplicate, keeping first-seen order. Then determine the **primary key**:

- If the branch name contained a key, that is the primary key.
- Otherwise, if exactly one distinct key was found across all sources, that is
  the primary key.
- Otherwise there is no primary key.

Do not scan diff contents or file bodies for keys — code and fixtures contain
strings that look like keys but aren't.

## Output contract

Reply with **exactly four fenced code blocks**, each preceded by its bold label
and nothing else — no preamble, no commentary between the blocks, no summary
after them. Each block holds one field, so each can be copied straight into the
field it belongs to.

Fence every block with **four** backticks and the `markdown` info string. Four
are required because the content contains triple-backtick fences and inline
code; a three-backtick fence would terminate early and break the block.

The whole reply looks exactly like this:

    **PR title**

    ````markdown
    <imperative one-liner covering the whole branch> (ABC-123)
    ````

    **PR description**

    ````markdown
    ## Summary

    <1–3 sentence overview of what this PR does and why>

    ### `<file or module>`

    <per-area breakdown>

    ### `<next file or module>`

    <per-area breakdown>

    ## Jira

    ABC-123
    ````

    **Commit subject**

    ````markdown
    <imperative one-liner covering only the pending changes> (ABC-123)
    ````

    **Commit body**

    ````markdown
    <3–6 lines explaining what changed and why>
    ````

When there are no Jira keys, the shape is identical except the `## Jira` section
is absent and no key is appended to the title or subject.

## Field rules

**PR title** — one line, under 70 characters, imperative mood, no trailing
period. Describes the branch as a whole, not just the pending commit. If there
is a primary key, append it in parentheses: `Add x feature (ABC-123)`. Append
at most one key, never a list.

**PR description** — starts at `## Summary`; the title is not repeated inside
it. Covers the cumulative branch diff from step 3. One `###` section per changed
area, covering every changed area. Say what changed and the non-obvious
reasoning behind it. For deleted files, say what they replaced and why they're
gone. For new files, explain their role and any design decisions worth noting.

**`## Jira` section** — include it only if at least one key was found. List every
distinct key, one per line, in the order collected. Omit the entire section when
there are none: no heading, no placeholder, no "N/A", no sentence explaining the
absence.

**Commit subject** — describes only the pending changes from step 2. Imperative
mood, ≤72 chars, no trailing period. If there is a primary key, append it in
parentheses. It will often differ from the PR title, since the PR covers more
ground — do not copy one into the other unless the branch has only this one
commit.

**Commit body** — 3–6 lines on the pending changes only, explaining *what*
changed and *why*, not a re-listing of files. No bullet points. No
"Co-Authored-By" trailer. No blank first line; the block starts on the body's
first word. Wrap at 72 characters.

## Constraints

- Never invent a Jira key, never ask the user for one, and never mention Jira,
  tickets, or issue tracking anywhere in the output when no key was found.
- Describe only changes that are actually present in the diff. Do not infer
  formatting or refactoring work that isn't there.
- The PR description describes the branch's **end state**, not its history. The
  cumulative diff already collapses intermediate churn — a file added in an
  earlier commit and deleted in the pending changes simply isn't there. Never
  narrate the branch commit by commit, and never mention a change that the
  cumulative diff doesn't show, even if `git log` implies it happened.
- Use `git log` for context and ordering only, never as the source of truth for
  what changed. The diffs are the source of truth.
- Do not ask for confirmation before producing the output.
