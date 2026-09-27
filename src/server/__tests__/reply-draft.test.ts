import { describe, expect, it } from "vitest";
import { latestUnsentReplyDraft } from "@/server/telegram-inbox-query";

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
