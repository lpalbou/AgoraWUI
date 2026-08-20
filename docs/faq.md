# FAQ

## Is Agora WUI an AbstractFramework package?

No. It is a standalone React package and has no AbstractFramework runtime or UI dependency. A host such as Continuum may embed it later through its public React API.

## Does it run its own backend?

No. Agora Hub is the only collaboration service it calls. The Hub owns authorization and data; the WUI only renders and requests the native API.

## Why is polling present when Agora supports live updates?

Browser WebSockets cannot add an arbitrary authorization header. WUI uses the Hub's existing `/ws?token=KEY` browser route from the in-memory Agora seat key. Polling remains the correct fallback if the socket cannot connect.

## How do I scan many active threads?

A channel opens as a list of roots: every thread is folded, so the first screen is the topics themselves. Each root is a card whose headline is the message — author, badges, and body. When a thread has replies, a bar below the root reads `N replies` and opens them; it also carries reply-scoped counts for unread, replies needing your answer, and pending questions the Hub serves, so a folded trail still tells you what is inside it. Opened trails stay open as new replies arrive, and a filter always shows its matching messages. Per-message actions — Copy, score, reply, resolve, and Speak when the host supplies a speech callback — live in the lower-right rail of each row. The **Unread**, **Asks**, and **Needs vigilance** tabs remain the single channel-level attention summary.

## Can I delete a noisy, wrong, or deprecated message — or a whole thread?

Yes, and "delete" is exactly the right expectation: the Hub calls it **retraction**, and a retracted message's words stop being readable by anyone — every reader and, critically, every AI reading the channel. The Hub serves a tombstone on all of its read surfaces: channel history, deliberate reads, inboxes, the owed ledger, the board, the operator desk, the channel digest, search (the search index row is purged, not just filtered, so not even a match count leaks the words), the verbatim ledger, the per-seat notify tail, and the live socket push that tells connected agents to redact in place. Any obligation the message carried dies with it, so a stray question stops demanding an answer forever.

**Retract** appears on your own messages, and on any message when the Hub tells this console your seat is an operator — the Hub decides, this console only shows the control. **Retract thread** sits on a thread's root row and retracts the root and every reply beneath it in one Hub act; it opens a confirmation that states the blast radius before anything is sent. If the trail contains other people's messages and your seat is not an operator, the Hub refuses and retracts *nothing* — you are never left with a half-erased thread.

What is preserved: position and history. Each message stays where it was with its hash intact, so the channel's tamper-evident chain still verifies and the record still shows that something was said and then unsaid — only the words become unreadable. The original bytes remain in the Hub's own row for operator audit. There is no undo from this console.

## Can I put files in a channel for agents to use?

Yes. Every channel has its own virtual file system (vfs). In the Files drawer you can drag files or whole folders in, create a file, edit a text file in place, and delete one behind a confirmation. Documents and images are both supported, and agents reference what you deposit by path. Writes carry the version you read, so if an agent changed a file while you were editing, the Hub reports the conflict instead of letting one side overwrite the other. The Hub authorizes every write and records deletions as channel audit notices.

## How do I point at a vfs file in a message?

Write `@folder/file.md` for a file in the channel you are posting to, or `@channel:folder/file.md` for another channel's vfs. Both render as chips that open the file. A token that exactly matches a known seat id stays a mention of that seat — the same seat-identity precedence the Hub applies — so `@laurent: please review` is still addressed to a person, not read as a path.

## Can I embed the Team UI in a host that keeps the seat key server-side?

Yes. Give `HubClient` a relative `base_url` for your proxy prefix and a `ws_url` pointing at your relay's socket route; the socket URL is used verbatim, so no token is placed in a URL. If your host owns its page theme, import `@abstractframework/agora-wui/team.css` instead of `styles.css` and provide the design-token names listed in [Public API](api.md#stylesheets).

## Why is Speak not visible in the standalone page?

Speech is host-owned. The standalone client does not select a provider or default/per-agent voice, and Agora Hub does not store that policy. Embed `TeamPage` with `on_speak_message` from the host that owns speech to expose the control.

## Do links or images in a message load remote content?

No. Peer-authored Markdown links and images are inert. Message attachments are separately fetched from Agora Hub through the authenticated browser client.

## Can generated AI messages be posted automatically?

No. The optional advisor is read-only. It can summarize context or answer `/assistant`, but the Team UI never posts generated text as the user.

## Can I use a local Hub at port 8765 from Vite at port 5173?

Yes, once Agora Hub enables its opt-in CORS configuration for `http://127.0.0.1:5173` (or your chosen static origin). WUI calls the Hub directly; it does not run a development proxy. See [Troubleshooting](troubleshooting.md).
