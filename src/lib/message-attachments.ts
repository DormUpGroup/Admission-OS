import path from "path";

export type MessageAttachment = {
  name: string;
  fileUrl: string;
  storagePath?: string;
  documentId?: string;
};

export const MESSAGE_ATTACHMENT_FOLDER = "messages";
export const MAX_MESSAGE_FILES = 5;
export const MAX_MESSAGE_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".doc",
  ".docx",
]);

export function messageFileExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isAllowedMessageFilename(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(messageFileExtension(filename));
}

export function isMessageAttachmentStoragePath(storagePath: string): boolean {
  const parts = storagePath.split("/").filter(Boolean);
  return parts.length >= 3 && parts[1] === MESSAGE_ATTACHMENT_FOLDER;
}

export function contentTypeForFilename(filename: string): string {
  switch (messageFileExtension(filename)) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

export function parseMessageAttachments(raw: unknown): MessageAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const fileUrl = typeof rec.fileUrl === "string" ? rec.fileUrl.trim() : "";
    if (!name || !fileUrl) continue;
    out.push({
      name,
      fileUrl,
      storagePath:
        typeof rec.storagePath === "string" ? rec.storagePath : undefined,
      documentId:
        typeof rec.documentId === "string" ? rec.documentId : undefined,
    });
  }
  return out;
}
