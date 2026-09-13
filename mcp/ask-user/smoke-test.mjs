#!/usr/bin/env node
// Smoke test for ask-user-mcp: acts as an MCP client over stdio, so it exercises
// the real wire protocol rather than importing the server's internals.
// Run: node mcp/ask-user/smoke-test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.mjs");

/**
 * Spawn the server and act as a real MCP client over stdio, so the wire protocol is
 * exercised rather than the server`s internals.
 *
 * @param {{ elicitation: boolean }} options Whether to advertise the capability,
 *   which is what selects the interactive path or the text fallback.
 * @returns {{
 *   ready: Promise<object>,
 *   call: (method: string, params?: object) => Promise<object>,
 *   send: (message: object) => void,
 *   stop: () => void,
 *   answerNext: (reply: (params: object) => object) => Promise<object>,
 * }}
 */
const startClient = ({ elicitation }) => {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  const waiters = new Map();
  let onServerRequest = null;
  let buffer = "";
  let nextId = 1;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.method) {
        if (onServerRequest) onServerRequest(message);
        continue;
      }
      const waiter = waiters.get(message.id);
      waiters.delete(message.id);
      if (waiter) waiter(message);
    }
  });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const call = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiters.set(id, (message) => {
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });
  };

  const ready = call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: elicitation ? { elicitation: {} } : {},
    clientInfo: { name: "smoke-test", version: "1.0.0" },
  }).then((result) => {
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return result;
  });

  return {
    ready,
    call,
    send,
    stop: () => child.kill(),
    // Answer the next elicitation the server sends, using `reply(params)` to
    // build the response body.
    answerNext: (reply) =>
      new Promise((resolve) => {
        onServerRequest = (message) => {
          onServerRequest = null;
          assert.equal(message.method, "elicitation/create");
          send({ jsonrpc: "2.0", id: message.id, result: reply(message.params) });
          resolve(message.params);
        };
      }),
  };
};

const QUESTIONS = [
  {
    header: "Surface",
    question: "Which Copilot surface should this target?",
    options: [
      { label: "VS Code (recommended)", description: "Elicitation is documented there." },
      { label: "Copilot CLI", description: "Closest to the current workflow." },
    ],
  },
  {
    header: "Extras",
    question: "Which extras should be included?",
    multiSelect: true,
    options: [
      { label: "Instructions file", description: "Tells the model when to ask." },
      { label: "Smoke test", description: "Verifies the protocol end to end." },
    ],
  },
];

/**
 * The elicitation path: handshake, tool listing, accept, `Other` free text, decline,
 * cancel, and invalid input. Also asserts the requested schema stays a flat object of
 * primitives, which is the constraint the whole design bends around.
 *
 * @returns {Promise<void>}
 */
const testInteractive = async () => {
  const client = startClient({ elicitation: true });
  const init = await client.ready;
  assert.equal(init.protocolVersion, "2025-06-18");
  assert.equal(init.serverInfo.name, "ask-user-mcp");
  assert.match(init.instructions, /ask_user_question/);

  const { tools } = await client.call("tools/list");
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "ask_user_question");
  assert.equal(tools[0].inputSchema.properties.questions.maxItems, 4);

  // Accept: pick option 2 for the single-select, one box for the multiSelect.
  const answered = client.answerNext(() => ({
    action: "accept",
    content: { q0: "Copilot CLI", q1o0: true, q1o1: false },
  }));
  const accepted = await client.call("tools/call", {
    name: "ask_user_question",
    arguments: { questions: QUESTIONS },
  });
  const params = await answered;

  // The elicitation schema must stay a flat object of primitives.
  const props = params.requestedSchema.properties;
  assert.deepEqual(props.q0.enum, ["VS Code (recommended)", "Copilot CLI", "Other"]);
  assert.equal(props.q1o0.type, "boolean");
  assert.equal(props.q1o1.type, "boolean");
  assert.equal(props.q0_other.type, "string");
  assert.deepEqual(params.requestedSchema.required, ["q0"]);
  for (const value of Object.values(props)) {
    assert.ok(["string", "number", "integer", "boolean"].includes(value.type));
  }
  // Option descriptions ride along in the message, since the schema can't nest them.
  assert.match(params.message, /Elicitation is documented there\./);

  const acceptedText = accepted.content[0].text;
  assert.match(acceptedText, /A: Copilot CLI/);
  assert.match(acceptedText, /A: Instructions file/);
  assert.ok(!/Smoke test/.test(acceptedText.split("A: Instructions file")[1] ?? ""));

  // Other: a free-text answer wins over the enum choice.
  const answeredOther = client.answerNext(() => ({
    action: "accept",
    content: { q0: "Other", q0_other: "All three surfaces", q1o1: true },
  }));
  const other = await client.call("tools/call", {
    name: "ask_user_question",
    arguments: { questions: QUESTIONS },
  });
  await answeredOther;
  assert.match(other.content[0].text, /A: Other: All three surfaces/);

  // Decline and cancel must tell the model to keep going, not to re-ask.
  const declining = client.answerNext(() => ({ action: "decline" }));
  const declined = await client.call("tools/call", {
    name: "ask_user_question",
    arguments: { questions: [QUESTIONS[0]] },
  });
  await declining;
  assert.match(declined.content[0].text, /declined/);
  assert.match(declined.content[0].text, /Do not ask again/);

  const cancelling = client.answerNext(() => ({ action: "cancel" }));
  const cancelled = await client.call("tools/call", {
    name: "ask_user_question",
    arguments: { questions: [QUESTIONS[0]] },
  });
  await cancelling;
  assert.match(cancelled.content[0].text, /dismissed/);

  // Bad input is reported in-band so the model can correct itself.
  const invalid = await client.call("tools/call", {
    name: "ask_user_question",
    arguments: {
      questions: [
        { header: "X", question: "One option?", options: [{ label: "a", description: "b" }] },
      ],
    },
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /at least 2 options/);

  await assert.rejects(
    () => client.call("tools/call", { name: "nope", arguments: {} }),
    /Unknown tool/,
  );

  client.stop();
};

/**
 * The no-elicitation path: the server must never send `elicitation/create`, and must
 * instead return text telling the model to ask inline and wait.
 *
 * @returns {Promise<void>}
 */
const testFallback = async () => {
  const client = startClient({ elicitation: false });
  await client.ready;

  // No elicitation capability: never send elicitation/create, return text instead.
  let elicited = false;
  client.answerNext(() => {
    elicited = true;
    return { action: "cancel" };
  });

  const result = await client.call("tools/call", {
    name: "ask_user_question",
    arguments: { questions: QUESTIONS },
  });
  const text = result.content[0].text;
  assert.equal(elicited, false);
  assert.match(text, /does not support interactive prompts/);
  assert.match(text, /Which Copilot surface should this target\?/);
  assert.match(text, /pick any that apply/);
  assert.match(text, /stop and wait/);

  client.stop();
};

await testInteractive();
await testFallback();
console.log("ask-user-mcp: all checks passed");
