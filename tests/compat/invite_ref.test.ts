import { describe, expect, it } from "vitest";

import { looks_like_invite_ref, parse_invite_ref } from "../../src/lib/invite_ref";

// The exact sentence Agora Hub DMs an invitee (create_group / invite_agent).
const DM_LINE =
  "You are invited to 'webos' — focused room: Build the single-file WebOS. " +
  "Join with join_channel(channel='webos', invite_token='invite_03a92fb96dc03f476f611d25858008cf8525dcf63614a06a'), " +
  "read the opening post, and work the topic THERE (not in commons).";

describe("invite reference", () => {
  it("reads both halves out of the invitation DM verbatim", () => {
    expect(parse_invite_ref(DM_LINE)).toEqual({
      channel: "webos",
      invite_token: "invite_03a92fb96dc03f476f611d25858008cf8525dcf63614a06a",
    });
  });

  it("reads a bare token with no surrounding prose", () => {
    const ref = parse_invite_ref("invite_97e2294b938312304a9e549d3d12c938b726560ea9b121ae");
    expect(ref.invite_token).toBe("invite_97e2294b938312304a9e549d3d12c938b726560ea9b121ae");
    expect(ref.channel).toBe("");
  });

  it("reads the public-channel invitation, which carries no token", () => {
    const ref = parse_invite_ref("You are invited to 'rtype' (public). Join with join_channel(channel='rtype').");
    expect(ref).toEqual({ channel: "rtype", invite_token: "" });
  });

  it("leaves an ordinary channel name alone so typing one is not hijacked", () => {
    expect(parse_invite_ref("webos")).toEqual({ channel: "", invite_token: "" });
    expect(looks_like_invite_ref("webos")).toBe(false);
    expect(looks_like_invite_ref("invite-me-maybe")).toBe(false);
  });

  it("recognises an invitation, and only an invitation", () => {
    expect(looks_like_invite_ref(DM_LINE)).toBe(true);
    expect(looks_like_invite_ref("")).toBe(false);
    expect(looks_like_invite_ref("  ")).toBe(false);
  });

  it("survives whatever was actually pasted", () => {
    expect(() => parse_invite_ref(undefined as any)).not.toThrow();
    expect(parse_invite_ref(`join_channel(channel="webos", invite_token="invite_ABC12345")`)).toEqual({
      channel: "webos",
      invite_token: "invite_ABC12345",
    });
  });
});
