#!/usr/bin/env node
// Tests for bin/install. Like mcp/ask-user/smoke-test.mjs, it drives the real
// thing as a subprocess and asserts on the filesystem it produced, rather than
// importing internals — the installer's whole job is the state it leaves behind.
// Run: node bin/install-test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "install");
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dotai-test-"));
const SOURCE = path.join(ROOT, "source");
const HOME = path.join(ROOT, "home");
const PROJECT = path.join(ROOT, "project");

/**
 * Write a fixture file, creating parent folders as needed.
 *
 * @param {string} file
 * @param {string} text
 */
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
/** @param {string} file @returns {string} */
const read = (file) => fs.readFileSync(file, "utf8");

/**
 * Run the real installer as a subprocess.
 *
 * Deliberately not importing it: the installer`s whole job is the state it leaves on
 * disk, and its exit code is part of its contract, so both are exercised for real.
 *
 * @param {string[]} args
 * @returns {{ status: number, out: string, stdout: string, stderr: string }}
 *   `out` is stdout and stderr joined, since refusals and plans go to both.
 */
const install = (args) => {
  const run = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
  return { ...run, out: `${run.stdout}${run.stderr}` };
};

// --- a neutral source tree, one asset of every kind -------------------------

write(
  path.join(SOURCE, "skills/pr/SKILL.md"),
  "---\nname: pr\ndescription: Write up a pull request.\n---\n\nDo the PR thing.\n",
);
write(path.join(SOURCE, "skills/pr/references/style.md"), "Bundled reference, copied verbatim.\n");
write(
  path.join(SOURCE, "prompts/pr.md"),
  "---\ndescription: Open a PR for this branch.\nargumentHint: '[base-branch]'\n---\n\nOpen a PR.\n",
);
// A description a YAML reader would misread unquoted: it contains `: ` and an
// apostrophe, so the writer has to quote it and escape the apostrophe by doubling.
write(
  path.join(SOURCE, "prompts/tricky.md"),
  '---\ndescription: "It\'s tricky: really"\n---\n\nBody.\n',
);
// No applyTo, so this one is composed into the project's instruction files.
write(path.join(SOURCE, "instructions/ask-first.md"), "## Ask before you diverge\n\nAsk first.\n");
// Has applyTo, so it stays a scoped instruction file instead.
write(
  path.join(SOURCE, "instructions/typescript.md"),
  "---\ndescription: TypeScript rules.\napplyTo: '**/*.ts'\n---\n\nNo any.\n",
);
write(
  path.join(SOURCE, "agents/rubber-duck.md"),
  "---\nname: rubber-duck\ndescription: Critique the work.\ntools: [read, grep]\n---\n\nCritique.\n",
);
write(path.join(SOURCE, "hooks/pre-commit.json"), '{ "event": "preCommit" }\n');
write(path.join(SOURCE, "mcp/ask-user/server.mjs"), "// stand-in\n");

// The real source folders each carry a .gitkeep so the layout survives in git even
// when empty. Discovery must never mistake one for an asset — in any folder, whether
// it looks for files or for directories.
for (const dir of ["skills", "instructions", "prompts", "agents", "hooks", "mcp"]) {
  write(path.join(SOURCE, dir, ".gitkeep"), "");
}

const base = ["--source", SOURCE, "--home", HOME];

// --- list ------------------------------------------------------------------

{
  const { out, status } = install(["list", ...base]);
  assert.equal(status, 0, out);
  for (const name of ["pr", "ask-first", "typescript", "rubber-duck", "pre-commit", "ask-user"]) {
    assert.match(out, new RegExp(name), `list should mention ${name}`);
  }
  // An always-on fragment is composed, so the listing must not name the scoped
  // destinations it never reaches.
  const askFirst = out.slice(out.indexOf("ask-first"), out.indexOf("typescript"));
  assert.match(askFirst, /composed into/);
  assert.doesNotMatch(askFirst, /\.github\/instructions/);
  // Layout placeholders are not assets.
  assert.doesNotMatch(out, /gitkeep/);
  const scoped = out.slice(out.indexOf("typescript"));
  assert.match(scoped, /\.github\/instructions/);
}

// --- dry run changes nothing ----------------------------------------------

{
  const { out, status } = install(["personal", ...base, "--dry-run"]);
  assert.equal(status, 0, out);
  assert.match(out, /\(dry run\)/);
  assert.equal(fs.existsSync(HOME), false, "dry run must not touch the filesystem");
}

// --- personal: symlink where nothing was rewritten, copy where it was ------

{
  const { out, status } = install(["personal", ...base]);
  assert.equal(status, 0, out);

  // Skills go in whole, as links, so editing the repo is live everywhere.
  for (const dir of [".claude/skills/pr", ".copilot/skills/pr"]) {
    const link = path.join(HOME, dir);
    assert.ok(fs.lstatSync(link).isSymbolicLink(), `${dir} should be a symlink`);
    assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(SOURCE, "skills/pr")));
  }

  // The neutral instruction dialect is already Copilot's, so it can be linked.
  const scoped = path.join(HOME, ".copilot/instructions/typescript.instructions.md");
  assert.ok(
    fs.lstatSync(scoped).isSymbolicLink(),
    "an unrewritten file should be linked, not copied",
  );

  // A Claude command needs argumentHint -> argument-hint, so it must be a real file.
  const command = path.join(HOME, ".claude/commands/pr.md");
  assert.ok(!fs.lstatSync(command).isSymbolicLink(), "a rewritten file must not be a symlink");
  assert.match(
    read(command),
    /^---\ndescription: Open a PR for this branch\.\nargument-hint: '\[base-branch\]'\n---\n/,
  );
  assert.match(read(command), /dotai:generated from prompts\/pr\.md/);
  assert.doesNotMatch(read(command), /argumentHint/);

  assert.match(read(path.join(HOME, ".claude/agents/rubber-duck.md")), /tools: \[read, grep\]/);

  // A risky value is quoted and its apostrophe doubled, so the result is still valid
  // YAML and still round-trips through the parser.
  const tricky = read(path.join(HOME, ".claude/commands/tricky.md"));
  assert.match(tricky, /^---\ndescription: 'It''s tricky: really'\n---\n/);

  // No placeholder leaked through as an installed asset.
  assert.equal(
    fs.readdirSync(path.join(HOME, ".claude/skills")).some((e) => e.includes("gitkeep")),
    false,
    "a .gitkeep must not be installed as a skill",
  );

  // Always-on fragments are composed into each tool's own always-on file. For
  // Copilot that is copilot-instructions.md specifically — the only home-level
  // file it reads.
  const homeCopilot = read(path.join(HOME, ".copilot/copilot-instructions.md"));
  assert.match(homeCopilot, /Ask before you diverge/);
  assert.match(homeCopilot, /dotai:begin/);
  assert.match(read(path.join(HOME, ".claude/CLAUDE.md")), /Ask before you diverge/);

  // ...and are not also delivered as a scoped instruction file, which would give
  // Copilot the same rule twice.
  assert.equal(
    fs.existsSync(path.join(HOME, ".copilot/instructions/ask-first.instructions.md")),
    false,
    "an always-on fragment must not also become a scoped file",
  );

  // Gaps are reported rather than silently skipped.
  assert.match(out, /Not installed, by design:/);
  assert.match(out, /agents\/personal\/copilot/);
}

// --- project: copies, composition, and the CLAUDE.md pointer ---------------

fs.mkdirSync(PROJECT, { recursive: true });

{
  const { out, status } = install(["project", PROJECT, ...base]);
  assert.equal(status, 0, out);

  // One skill copy: .claude/skills serves Claude Code and Copilot CLI both.
  const skill = path.join(PROJECT, ".claude/skills/pr/SKILL.md");
  assert.match(read(skill), /dotai:generated from skills\/pr\/SKILL\.md/);
  assert.ok(!fs.lstatSync(skill).isSymbolicLink(), "project assets are copies, not links");
  assert.equal(
    fs.existsSync(path.join(PROJECT, ".github/skills")),
    false,
    "no duplicate skill copy",
  );
  // Bundled files ride along untouched.
  assert.equal(
    read(path.join(PROJECT, ".claude/skills/pr/references/style.md")),
    "Bundled reference, copied verbatim.\n",
  );

  // Both prompt dialects, from one source.
  assert.match(read(path.join(PROJECT, ".claude/commands/pr.md")), /argument-hint/);
  assert.match(read(path.join(PROJECT, ".github/prompts/pr.prompt.md")), /description: Open a PR/);
  assert.doesNotMatch(read(path.join(PROJECT, ".github/prompts/pr.prompt.md")), /argument-hint/);

  assert.match(
    read(path.join(PROJECT, ".github/instructions/typescript.instructions.md")),
    /applyTo: '\*\*\/\*\.ts'/,
  );
  assert.match(read(path.join(PROJECT, ".github/agents/rubber-duck.md")), /name: rubber-duck/);
  assert.equal(
    read(path.join(PROJECT, ".github/hooks/pre-commit.json")),
    '{ "event": "preCommit" }\n',
  );

  // Unscoped fragments are composed; scoped ones stay files.
  const agents = read(path.join(PROJECT, "AGENTS.md"));
  assert.match(agents, /<!-- dotai:begin -->/);
  assert.match(agents, /Ask before you diverge/);
  assert.doesNotMatch(agents, /No any\./);
  assert.equal(
    fs.existsSync(path.join(PROJECT, ".github/instructions/ask-first.instructions.md")),
    false,
    "an always-on fragment must not also become a scoped file",
  );

  // Claude Code reads only CLAUDE.md, so it points at AGENTS.md rather than duplicating it.
  assert.match(read(path.join(PROJECT, "CLAUDE.md")), /@AGENTS\.md/);
}

// --- re-running is idempotent ---------------------------------------------

{
  const before = read(path.join(PROJECT, "AGENTS.md"));
  const { out, status } = install(["project", PROJECT, ...base]);
  assert.equal(status, 0, out);
  assert.equal(read(path.join(PROJECT, "AGENTS.md")), before, "a second run must not drift");
  assert.match(out, /0 skipped/);
}

// --- a project's own writing survives ------------------------------------

{
  const agentsPath = path.join(PROJECT, "AGENTS.md");
  write(
    agentsPath,
    `# House rules\n\nProject-specific policy that must survive.\n\n${read(agentsPath)}`,
  );
  const { status, out } = install(["project", PROJECT, ...base]);
  assert.equal(status, 0, out);
  const agents = read(agentsPath);
  assert.match(agents, /Project-specific policy that must survive\./);
  assert.match(agents, /Ask before you diverge/);
  assert.equal(agents.match(/dotai:begin/g).length, 1, "exactly one managed block");
}

// --- hand-written files are refused, not clobbered -----------------------

{
  const claudePath = path.join(PROJECT, "CLAUDE.md");
  write(claudePath, "# Hand-written, no marker\n");
  const { out, status } = install(["project", PROJECT, ...base]);
  assert.equal(status, 1, "refusing to overwrite should be a failure exit");
  assert.match(out, /refusing to overwrite hand-written/);
  assert.equal(read(claudePath), "# Hand-written, no marker\n", "the file must be untouched");

  const forced = install(["project", PROJECT, ...base, "--force"]);
  assert.equal(forced.status, 0, forced.out);
  assert.match(read(claudePath), /@AGENTS\.md/);
}

// --- filters and validation ---------------------------------------------

{
  const only = path.join(ROOT, "only");
  fs.mkdirSync(only, { recursive: true });
  const { status, out } = install([
    "project",
    only,
    ...base,
    "--only",
    "typescript",
    "--targets",
    "copilot",
  ]);
  assert.equal(status, 0, out);
  assert.ok(fs.existsSync(path.join(only, ".github/instructions/typescript.instructions.md")));
  assert.equal(
    fs.existsSync(path.join(only, ".claude/skills/pr")),
    false,
    "--only should exclude the skill",
  );
  assert.equal(
    fs.existsSync(path.join(only, "CLAUDE.md")),
    false,
    "--targets copilot should skip composition",
  );

  const bad = install(["project", only, ...base, "--targets", "cursor"]);
  assert.equal(bad.status, 1);
  assert.match(bad.out, /Unknown target/);

  const missing = install(["project", path.join(ROOT, "nope"), ...base]);
  assert.equal(missing.status, 1);
  assert.match(missing.out, /No such directory/);
}

// --- mcp registration is planned as a real copilot call -----------------

{
  const { out, status } = install(["mcp", ...base, "--dry-run"]);
  assert.equal(status, 0, out);
  assert.match(out, /copilot mcp add ask-user -- node .*server\.mjs/);
}

fs.rmSync(ROOT, { recursive: true, force: true });
console.log("bin/install: all checks passed");
