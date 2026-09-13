#!/usr/bin/env node
// Verify that every internal link in the documentation actually goes somewhere.
//
// Worth having because this repo's docs are a large part of the deliverable, and both
// failure modes are silent: renaming a heading breaks every anchor pointing at it, and
// moving a file breaks every relative link, with nothing to notice either until a
// reader clicks. Neither shows up in a test suite that only exercises code.
//
// External URLs are deliberately not checked. That needs network, fails for reasons
// that have nothing to do with this repo, and would make the suite flaky.
//
// Run: node bin/check-docs.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Punctuation GitHub drops when turning a heading into an anchor.
 *
 * This is a reimplementation of `github-slugger`, which is what GitHub's own pipeline
 * uses, and that is the weak point of this script: it is a copy of someone else's
 * rules rather than the rules themselves. If anchors start reporting wrongly, suspect
 * this first, and consider taking `github-slugger` as a devDependency instead. The
 * relative-path half of the checker has no such caveat — it just asks the filesystem.
 */
const SLUG_STRIP = /[ -⁯⸀-⹿\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g;

/**
 * Slugify one heading the way GitHub would.
 *
 * @param {string} text Heading text, without the leading hashes.
 * @returns {string}
 */
const slug = (text) => text.trim().toLowerCase().replace(SLUG_STRIP, "").replace(/\s/g, "-");

/**
 * Read a markdown file as lines, flagging which are inside a fenced code block.
 *
 * Fenced content has to be excluded or every example command and JSON snippet becomes
 * a false positive. Fences are tracked by length rather than matched literally,
 * because `skills/pr/SKILL.md` nests three-backtick fences inside four-backtick ones
 * and a naive pairing gets them the wrong way round.
 *
 * @param {string} text
 * @returns {{ number: number, text: string, fenced: boolean }[]}
 */
const readLines = (text) => {
  const out = [];
  let openFence = 0;
  text.split("\n").forEach((line, i) => {
    const fence = line.match(/^\s*(`{3,})/);
    if (fence) {
      const length = fence[1].length;
      // A closing fence must be at least as long as the one that opened it.
      if (openFence === 0) openFence = length;
      else if (length >= openFence) openFence = 0;
      out.push({ number: i + 1, text: line, fenced: true });
      return;
    }
    out.push({ number: i + 1, text: line, fenced: openFence > 0 });
  });
  return out;
};

/**
 * Every anchor a file offers, in GitHub's own form.
 *
 * Duplicate headings matter: GitHub suffixes repeats as `-1`, `-2` and so on, so a
 * link to the second "Install" needs `#install-1`. Collapsing them into a set would
 * make a link to the second heading look valid when it is not.
 *
 * @param {{ text: string, fenced: boolean }[]} lines
 * @returns {Set<string>}
 */
const anchorsIn = (lines) => {
  const seen = new Map();
  const anchors = new Set();
  for (const line of lines) {
    if (line.fenced) continue;
    const heading = line.text.match(/^#{1,6}[ \t]+(.+?)[ \t]*$/);
    if (!heading) continue;
    const base = slug(heading[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
};

/**
 * Collect every markdown file in the repo.
 *
 * @param {string} dir
 * @param {string[]} [found]
 * @returns {string[]}
 */
const markdownFiles = (dir, found = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, found);
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found;
};

const files = markdownFiles(REPO).sort();

/** Anchors per file, so a cross-file link like `STATUS.md#next` can be checked too. */
const anchorsByFile = new Map(
  files.map((file) => [file, anchorsIn(readLines(fs.readFileSync(file, "utf8")))]),
);

const problems = [];
let checked = 0;

for (const file of files) {
  const lines = readLines(fs.readFileSync(file, "utf8"));
  const rel = path.relative(REPO, file);

  for (const line of lines) {
    if (line.fenced) continue;
    for (const match of line.text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|tel:)/.test(target)) continue;
      checked++;

      const [rawPath, fragment] = target.split("#");
      const where = `${rel}:${line.number}`;

      // A bare `#fragment` points inside this file; anything else names another one.
      const resolved = rawPath === "" ? file : path.resolve(path.dirname(file), rawPath);

      if (rawPath !== "" && !fs.existsSync(resolved)) {
        problems.push(`${where}  missing file: ${target}`);
        continue;
      }
      if (!fragment) continue;

      const anchors = anchorsByFile.get(resolved);
      if (!anchors) {
        // Linking to a fragment of something that is not markdown we cannot verify.
        continue;
      }
      if (!anchors.has(fragment)) {
        problems.push(`${where}  no such heading: ${target}`);
      }
    }
  }
}

for (const problem of problems) console.error(`  ${problem}`);
console.log(
  problems.length === 0
    ? `check-docs: ${checked} internal links across ${files.length} files all resolve`
    : `check-docs: ${problems.length} of ${checked} internal links broken`,
);
process.exit(problems.length === 0 ? 0 : 1);
