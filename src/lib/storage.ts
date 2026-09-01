import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const localRoot =
  process.env.STORAGE_LOCAL_PATH || "./storage/documents";

export async function saveDocumentFile(input: {
  studentId: string;
  documentId: string;
  filename: string;
  data: Buffer;
}) {
  const ext = path.extname(input.filename) || ".bin";
  const key = `${input.studentId}/${input.documentId}/${randomUUID()}${ext}`;
  const fullPath = path.join(process.cwd(), localRoot, key);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, input.data);
  return {
    storagePath: key,
    fileUrl: `/api/files/${key}`,
  };
}

export async function readDocumentFile(storagePath: string) {
  const fullPath = path.join(process.cwd(), localRoot, storagePath);
  return readFile(fullPath);
}
