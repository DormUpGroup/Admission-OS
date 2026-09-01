import { describe, expect, it } from "vitest";
import {
  isAllowedMessageFilename,
  isMessageAttachmentStoragePath,
  parseMessageAttachments,
} from "@/lib/message-attachments";

describe("message attachments", () => {
  it("allows common document and image types", () => {
    expect(isAllowedMessageFilename("passport.pdf")).toBe(true);
    expect(isAllowedMessageFilename("scan.PNG")).toBe(true);
    expect(isAllowedMessageFilename("note.exe")).toBe(false);
  });

  it("recognizes message storage paths only", () => {
    expect(
      isMessageAttachmentStoragePath("stu_1/messages/abc.pdf")
    ).toBe(true);
    expect(
      isMessageAttachmentStoragePath("stu_1/doc_2/abc.pdf")
    ).toBe(false);
  });

  it("parses attachment metadata without technical leftovers", () => {
    const parsed = parseMessageAttachments([
      { name: "Паспорт.pdf", fileUrl: "/api/files/a/messages/x.pdf" },
      { name: "", fileUrl: "/api/files/missing" },
      "UNKNOWN",
    ]);
    expect(parsed).toEqual([
      {
        name: "Паспорт.pdf",
        fileUrl: "/api/files/a/messages/x.pdf",
        storagePath: undefined,
        documentId: undefined,
      },
    ]);
  });
});
