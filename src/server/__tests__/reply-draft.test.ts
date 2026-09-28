import { describe, expect, it } from "vitest";
import {
  applyReplyDraftRevision,
  latestUnsentReplyDraft,
  locateLatestReplyDraft,
} from "@/server/telegram-inbox-query";

const draftAt = "2026-09-27T11:18:42.000Z";

function run(body: string, createdAt = draftAt) {
  return { outputJson: { drafts: [{ body, createdAt }] } };
}

describe("latestUnsentReplyDraft", () => {
  it("returns the newest draft body", () => {
    expect(
      latestUnsentReplyDraft(
        [
          run("старый", "2026-09-27T11:00:00.000Z"),
          run("Здравствуйте"),
        ].reverse(),
        [{ direction: "INBOUND", body: "Привет", createdAt: "2026-09-27T11:18:00.000Z" }],
      ),
    ).toBe("Здравствуйте");
  });

  it("skips a draft that was already sent", () => {
    expect(
      latestUnsentReplyDraft([run("Здравствуйте")], [
        {
          direction: "OUTBOUND",
          body: "Здравствуйте",
          createdAt: "2026-09-27T11:19:00.000Z",
        },
      ]),
    ).toBeNull();
  });

  it("skips a draft once staff replied after it", () => {
    expect(
      latestUnsentReplyDraft([run("Здравствуйте")], [
        {
          direction: "OUTBOUND",
          body: "Напишу сам",
          createdAt: "2026-09-27T11:20:00.000Z",
        },
      ]),
    ).toBeNull();
  });

  it("skips a draft the curator discarded", () => {
    expect(
      latestUnsentReplyDraft(
        [
          {
            outputJson: {
              drafts: [
                { body: "старый", createdAt: "2026-09-27T11:00:00.000Z" },
                { body: "Здравствуйте", createdAt: draftAt, discarded: true },
              ],
            },
          },
        ],
        [],
      ),
    ).toBeNull();
  });

  it("keeps a draft when the only outbound is older", () => {
    expect(
      latestUnsentReplyDraft([run("Здравствуйте")], [
        {
          direction: "OUTBOUND",
          body: "Ранее",
          createdAt: "2026-09-27T10:00:00.000Z",
        },
      ]),
    ).toBe("Здравствуйте");
  });
});

describe("reply draft revision", () => {
  const output = { drafts: [{ body: "Здравствуйте", createdAt: draftAt }] };

  it("finds the newest stored draft", () => {
    expect(locateLatestReplyDraft([{ id: "run-1", outputJson: output }])).toEqual({
      runId: "run-1",
      draftIndex: 0,
    });
  });

  it("replaces the draft text", () => {
    expect(applyReplyDraftRevision(output, 0, "  Новый текст  ")).toEqual({
      drafts: [{ body: "Новый текст", createdAt: draftAt, discarded: false }],
    });
  });

  it("discards the draft when the text is empty", () => {
    expect(applyReplyDraftRevision(output, 0, "  ")).toEqual({
      drafts: [{ body: "Здравствуйте", createdAt: draftAt, discarded: true }],
    });
  });
});
