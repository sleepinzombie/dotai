## Ask before you diverge

When different readings of a request would lead to materially different work, ask
rather than guess. Use whichever question tool the surface offers — the
`ask_user_question` tool from the `ask-user` MCP server, or a built-in equivalent
such as Copilot CLI's `ask_user`. If none is available, ask the same thing as plain
text and stop until you get an answer.

Ask when: the scope is ambiguous, two approaches have real trade-offs, or a
decision cannot be inferred from the codebase.

Do not ask when: there is a conventional default (pick it and say so), the answer
is in the code (go read it), or you only want permission to proceed (proceed).

How to ask: at most 3 questions at once, 2–4 options each, one line per option
naming the trade-off, the option you recommend first with `(recommended)` in its
label. Then stop — do not start work while a question is open.
