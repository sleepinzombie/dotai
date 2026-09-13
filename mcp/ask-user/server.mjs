#!/usr/bin/env node
// ask-user-mcp — an MCP server exposing one tool, `ask_user_question`, that asks
// the user a multiple-choice clarifying question and blocks until they answer.
//
// It is a stand-in for Claude Code's built-in AskUserQuestion, which GitHub
// Copilot has no equivalent of. The question is rendered by the *client* via MCP
// elicitation (`elicitation/create`), so the UI is whatever the host provides:
// a form in VS Code agent mode, a prompt in Copilot CLI.
//
// Zero dependencies on purpose: MCP over stdio is newline-delimited JSON-RPC 2.0,
// so there is no SDK to keep in step and `node server.mjs` is the whole install.
//
// Clients that do not advertise the `elicitation` capability still work — the
// tool degrades to returning the question as text for the model to print inline.

const SERVER_INFO = { name: "ask-user-mcp", version: "1.0.0" };
const PREFERRED_PROTOCOL = "2025-06-18"; // version that introduced elicitation
const KNOWN_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const ELICIT_TIMEOUT_MS = 30 * 60 * 1000;

// Guidance the host injects into the model's context, so the tool gets used for
// the right things without relying on the instructions file alone.
const INSTRUCTIONS = `Use the \`ask_user_question\` tool before starting work whenever different
readings of the request would lead to materially different work: an ambiguous
scope, a choice between approaches with real trade-offs, or a missing decision
that cannot be inferred from the codebase.

Do not use it for choices with an obvious default, for facts you can verify by
reading the code, or to ask for permission to proceed. Make routine judgment
calls yourself.`;

const TOOL = {
  name: "ask_user_question",
  title: "Ask the user a question",
  description:
    "Ask the user 1-4 clarifying questions, each with 2-4 suggested options, and " +
    "wait for their answer. Use when different readings of the request would lead " +
    "to materially different work. Put the option you recommend first and suffix " +
    'its label with "(recommended)". Every question also offers a free-text ' +
    '"Other" answer. Do not use this to ask whether to proceed, or for choices ' +
    "that have a conventional default you could pick yourself.",
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        description: "The questions to ask, all shown together in one form.",
        items: {
          type: "object",
          properties: {
            header: {
              type: "string",
              description:
                'Very short label for the decision, max 12 chars. e.g. "Auth method", "Surface".',
            },
            question: {
              type: "string",
              description: "The full question. Specific, and ends with a question mark.",
            },
            multiSelect: {
              type: "boolean",
              description:
                "true if the options are not mutually exclusive and several may be picked.",
            },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  label: {
                    type: "string",
                    description: "The choice itself, 1-5 words.",
                  },
                  description: {
                    type: "string",
                    description:
                      "One line on what this option means or what it implies. State the trade-off.",
                  },
                },
                required: ["label", "description"],
              },
            },
          },
          required: ["header", "question", "options"],
        },
      },
    },
    required: ["questions"],
  },
};

const OTHER = "Other";

/**
 * One choice offered for a question.
 *
 * @typedef {object} QuestionOption
 * @property {string} label       The choice itself, 1-5 words.
 * @property {string} description One line on what it means or implies.
 */

/**
 * One question as the model supplies it. This is the tool's input shape, mirrored by
 * `TOOL.inputSchema` — change one and you must change the other.
 *
 * @typedef {object} Question
 * @property {string} header             Short label for the decision, max 12 chars.
 * @property {string} question           The full question.
 * @property {QuestionOption[]} options  2-4 of them.
 * @property {boolean} [multiSelect]     True when several options may be picked.
 */

/** Capabilities the client advertised at initialize. Empty until then. */
let clientCapabilities = {};

/** Ids for server -> client requests. Prefixed on the wire to avoid colliding with
 * the client's own numbering. */
let nextRequestId = 1;

/**
 * In-flight server -> client requests, keyed by id, awaiting a response from stdin.
 *
 * @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>}
 */
const pendingRequests = new Map();

/**
 * Diagnostics go to stderr, never stdout — stdout is the JSON-RPC channel and any
 * stray byte there corrupts the stream.
 *
 * @param {...unknown} args
 */
const log = (...args) => console.error("[ask-user-mcp]", ...args);
/**
 * Write one JSON-RPC message. The transport is newline-delimited, so exactly one
 * message per line and no pretty-printing.
 *
 * @param {object} message
 */
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

/**
 * Whether the connected client advertised the `elicitation` capability at
 * initialize. Everything about which path a tool call takes follows from this.
 *
 * @returns {boolean}
 */
const supportsElicitation = () => {
  return Boolean(clientCapabilities && clientCapabilities.elicitation);
};

/**
 * Send a server -> client request and resolve when the matching response lands.
 *
 * Responses arrive on the same stdin stream as everything else, so the promise is
 * parked in `pendingRequests` keyed by id and settled later by `handleMessage`. The
 * timeout is generous — a person has to read the question and answer it — but it
 * exists so a client that never replies cannot wedge the tool call forever.
 *
 * @param {string} method
 * @param {object} params
 * @param {number} timeoutMs
 * @returns {Promise<object>} The response `result`.
 */
const request = (method, params, timeoutMs) => {
  const id = `s${nextRequestId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    pendingRequests.set(id, { resolve, reject, timer });
    send({ jsonrpc: "2.0", id, method, params });
  });
};

/**
 * Flatten the questions into an `elicitation/create` payload.
 *
 * Elicitation schemas are restricted to a flat object of primitives, which drives the
 * whole shape here: each question becomes either one enum property or, for
 * `multiSelect`, one boolean per option. Since the schema cannot nest, per-option
 * descriptions go into the prompt's `message` text instead of rendering as subtitles.
 *
 * Property names encode position so the answers can be mapped back — `q0` for the
 * first question's choice, `q0o1` for its second checkbox, `q0_other` for its
 * free-text field. `formatAnswers` decodes exactly this scheme, so the two functions
 * have to change together.
 *
 * @param {Question[]} questions
 * @returns {{ message: string, requestedSchema: object }}
 */
const buildElicitation = (questions) => {
  const properties = {};
  const required = [];
  const lines = [];

  questions.forEach((question, i) => {
    const options = question.options ?? [];
    lines.push(`${i + 1}. ${question.question}`);
    for (const option of options) {
      lines.push(`   • ${option.label} — ${option.description}`);
    }
    lines.push("");

    if (question.multiSelect) {
      options.forEach((option, j) => {
        properties[`q${i}o${j}`] = {
          type: "boolean",
          title: `${question.header}: ${option.label}`,
          description: option.description,
          default: false,
        };
      });
    } else {
      const labels = options.map((option) => option.label);
      const choices = labels.includes(OTHER) ? labels : [...labels, OTHER];
      properties[`q${i}`] = {
        type: "string",
        title: question.header,
        description: question.question,
        enum: choices,
      };
      required.push(`q${i}`);
    }

    properties[`q${i}_other`] = {
      type: "string",
      title: `${question.header} — other`,
      description:
        "Optional. Your own answer, if none of the options above fit (or to add a caveat).",
    };
  });

  return {
    message: lines.join("\n").trimEnd(),
    requestedSchema: { type: "object", properties, required },
  };
};

/**
 * Turn an accepted elicitation response back into readable Q/A text for the model.
 *
 * This is the other half of `buildElicitation` and depends on the same property
 * naming scheme; change one and you must change both.
 *
 * @param {Question[]} questions
 * @param {Record<string, unknown>} content Elicitation response `content`.
 * @returns {string}
 */
const formatAnswers = (questions, content) => {
  const parts = [];

  questions.forEach((question, i) => {
    const options = question.options ?? [];
    const other = (content[`q${i}_other`] ?? "").trim();
    let answer;

    if (question.multiSelect) {
      const picked = options
        .filter((_, j) => content[`q${i}o${j}`] === true)
        .map((option) => option.label);
      if (other) picked.push(`Other: ${other}`);
      answer = picked.length > 0 ? picked.join(", ") : "(nothing selected)";
    } else {
      const chosen = content[`q${i}`];
      if (chosen === OTHER || !chosen) {
        answer = other ? `Other: ${other}` : "(no answer)";
      } else {
        answer = other ? `${chosen} — plus: ${other}` : chosen;
      }
    }

    parts.push(`Q: ${question.question}\nA: ${answer}`);
  });

  return parts.join("\n\n");
};

/**
 * The no-elicitation path: hand the question back as text, with an instruction for
 * the model to present it inline and stop rather than guess.
 *
 * This is why the tool is safe to register on a host whose support is unknown. You
 * lose the picker, not the decision point.
 *
 * @param {Question[]} questions
 * @returns {string}
 */
const formatFallback = (questions) => {
  const body = questions
    .map((question, i) => {
      const options = (question.options ?? [])
        .map((option) => `   - ${option.label} — ${option.description}`)
        .join("\n");
      const note = question.multiSelect ? " (pick any that apply)" : "";
      return `${i + 1}. ${question.question}${note}\n${options}`;
    })
    .join("\n\n");

  return (
    "This host does not support interactive prompts, so the question was not shown " +
    "to the user. Present the following to the user as your reply, verbatim, then " +
    "stop and wait for their answer. Do not start work until they respond.\n\n" +
    `${body}\n\n(Answer with a number, an option name, or your own answer.)`
  );
};

/**
 * The tool itself: validate, then either elicit or degrade to text.
 *
 * Every outcome returns a string for the model rather than throwing, including the
 * ones a user might consider a failure. Decline and cancel each carry an explicit
 * instruction to carry on rather than re-ask, because a model that re-asks a
 * dismissed question is worse than one that guesses and says so.
 *
 * @param {{ questions?: Question[] }} args
 * @returns {Promise<string>}
 * @throws {Error} If `questions` is missing, empty, or an entry has under 2 options.
 */
const askUserQuestion = async (args) => {
  const questions = args?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("`questions` must be a non-empty array.");
  }
  for (const question of questions) {
    if (!question || typeof question.question !== "string" || !question.question.trim()) {
      throw new Error("Every question needs a non-empty `question` string.");
    }
    if (!Array.isArray(question.options) || question.options.length < 2) {
      throw new Error(`"${question.question}" needs at least 2 options.`);
    }
  }

  if (!supportsElicitation()) {
    return formatFallback(questions);
  }

  const result = await request(
    "elicitation/create",
    buildElicitation(questions),
    ELICIT_TIMEOUT_MS,
  );

  if (result?.action === "accept") {
    return formatAnswers(questions, result.content ?? {});
  }
  if (result?.action === "decline") {
    return (
      "The user declined to answer. Do not ask again. Choose the most reasonable " +
      "option yourself, say which one you chose and why in one sentence, and continue."
    );
  }
  return (
    "The user dismissed the question without answering. Proceed with your best " +
    "judgment, state the assumption you are working under, and continue."
  );
};

/**
 * Handle one client -> server request and return its result.
 *
 * @param {string} method
 * @param {object} [params]
 * @returns {Promise<object>}
 * @throws {Error} With a `code` set for protocol-level failures.
 */
const handleRequest = async (method, params) => {
  switch (method) {
    case "initialize": {
      clientCapabilities = params?.capabilities ?? {};
      const requested = params?.protocolVersion;
      // Echo the client's protocol version when it is one we know, so an older client
      // is not forced to speak a newer dialect. An unrecognised version — typically a
      // release newer than this server — falls back to the one that introduced
      // elicitation, which is the oldest version where the tool works properly.
      const protocolVersion = KNOWN_PROTOCOLS.includes(requested) ? requested : PREFERRED_PROTOCOL;
      log(
        `initialized with ${params?.clientInfo?.name ?? "unknown client"}`,
        `— elicitation ${supportsElicitation() ? "available" : "NOT available, will fall back to text"}`,
      );
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: [TOOL] };
    case "tools/call": {
      if (params?.name !== TOOL.name) {
        const error = new Error(`Unknown tool: ${params?.name}`);
        error.code = -32602;
        throw error;
      }
      const text = await askUserQuestion(params?.arguments ?? {});
      return { content: [{ type: "text", text }] };
    }
    default: {
      const error = new Error(`Method not found: ${method}`);
      error.code = -32601;
      throw error;
    }
  }
};

/**
 * Route one incoming message. Three cases, and telling them apart matters:
 * a response to something we asked (an id, no method), a notification (a method, no
 * id) which must never be answered, or a request (both) which must be.
 *
 * @param {object} message
 * @returns {Promise<void>}
 */
const handleMessage = async (message) => {
  // A response to something we asked the client (an elicitation).
  if (message.id !== undefined && message.method === undefined) {
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message ?? "request failed"));
    else pending.resolve(message.result);
    return;
  }

  if (message.method === undefined) return;

  // Notifications carry no id and must not be answered.
  if (message.id === undefined) return;

  try {
    const result = await handleRequest(message.method, message.params);
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    // Tool failures are reported in-band so the model can read and react to them;
    // protocol failures use a real JSON-RPC error.
    if (message.method === "tools/call" && error.code === undefined) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: error.code ?? -32603, message: error.message ?? "internal error" },
    });
  }
};

// ---------------------------------------------------------------------------
// Transport
//
// MCP over stdio is newline-delimited JSON-RPC, and a stream gives no guarantee that
// chunk boundaries line up with message boundaries: one chunk may carry several
// messages, or half of one. So chunks accumulate in `buffer` and only whole lines are
// consumed, leaving any partial tail to be completed by the next chunk. Framing this
// by hand is the reason the server needs no SDK.
// ---------------------------------------------------------------------------

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      // A malformed line is skipped rather than fatal: killing the process would take
      // the whole session down over one bad frame.
      log("ignoring unparseable line");
      continue;
    }
    // Deliberately not awaited. An elicitation blocks for as long as the person takes
    // to answer, and awaiting here would stall the read loop — including the very
    // response that resolves it.
    handleMessage(message).catch((error) => log("handler failed:", error.message));
  }
});

// Client closed the pipe: nothing more can arrive, so exit cleanly rather than
// lingering as an orphan.
process.stdin.on("end", () => process.exit(0));
