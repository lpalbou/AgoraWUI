// An invitation arrives as prose. Agora Hub DMs the invitee a sentence naming
// the call a native client would make:
//
//   Join with join_channel(channel='webos', invite_token='invite_03a9…'),
//   read the opening post, and work the topic THERE (not in commons).
//
// The token is single-use and membership begins only when it is redeemed, so
// the reader must get both halves out of that sentence and into a form. This
// reads them, which is why the console can accept the whole line pasted as-is
// rather than asking anyone to pick it apart by hand.

export type InviteRef = {
  channel: string;
  invite_token: string;
};

/** Read a channel and/or invite token out of pasted text. Both fields are ""
 *  when the text carries neither, so a caller can tell "nothing found" from a
 *  partial invitation (a bare token, or a channel name alone). Never throws:
 *  the input is whatever a person happened to paste. */
export function parse_invite_ref(text: string): InviteRef {
  const source = String(text || "");
  const channel = /channel\s*=\s*['"]([^'"]+)['"]/.exec(source)?.[1]
    || /\bjoin_channel\(\s*['"]([^'"]+)['"]/.exec(source)?.[1]
    || "";
  const invite_token = /invite_token\s*=\s*['"]([^'"]+)['"]/.exec(source)?.[1]
    || /\b(invite_[A-Za-z0-9]{8,})\b/.exec(source)?.[1]
    || "";
  return { channel: channel.trim(), invite_token: invite_token.trim() };
}

/** True when the text looks like an invitation rather than a name someone is
 *  typing: used to decide whether a field's own value should be replaced by
 *  the parsed halves instead of kept verbatim. */
export function looks_like_invite_ref(text: string): boolean {
  const ref = parse_invite_ref(text);
  return Boolean(ref.channel || ref.invite_token);
}
