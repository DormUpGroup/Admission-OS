import { randomUUID } from "crypto";
import path from "path";
import { contentTypeForFilename } from "@/lib/message-attachments";
import { supabaseAdmin } from "@/lib/supabase-admin";

const bucket = () => process.env.STORAGE_BUCKET || "documents";

let bucketReady: Promise<void> | null = null;

async function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const supabase = supabaseAdmin();
      const name = bucket();
      const { data, error } = await supabase.storage.getBucket(name);
      if (data && !error) return;
      const created = await supabase.storage.createBucket(name, {
        public: false,
        fileSizeLimit: "50MB",
      });
      if (created.error && !/already exists/i.test(created.error.message)) {
        throw new Error(created.error.message);
      }
    })().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }
  await bucketReady;
}

export async function saveDocumentFile(input: {
  studentId: string;
  documentId: string;
  filename: string;
  data: Buffer;
}) {
  const ext = path.extname(input.filename) || ".bin";
  const key = `${input.studentId}/${input.documentId}/${randomUUID()}${ext}`;
  await uploadObject(key, input.data, contentTypeForFilename(input.filename));
  return {
    storagePath: key,
    fileUrl: `/api/files/${key}`,
  };
}

export async function readDocumentFile(storagePath: string) {
  return downloadObject(storagePath);
}

export async function saveRawSnapshot(input: {
  key: string;
  content: string | Buffer;
}) {
  const data = Buffer.isBuffer(input.content)
    ? input.content
    : Buffer.from(input.content, "utf8");
  await uploadObject(input.key, data, "text/plain; charset=utf-8");
  return input.key;
}

async function uploadObject(
  key: string,
  data: Buffer,
  contentType: string,
) {
  await ensureBucket();
  const { error } = await supabaseAdmin()
    .storage.from(bucket())
    .upload(key, data, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

async function downloadObject(storagePath: string) {
  await ensureBucket();
  const { data, error } = await supabaseAdmin()
    .storage.from(bucket())
    .download(storagePath);
  if (error || !data) throw new Error(error?.message || "File not found");
  return Buffer.from(await data.arrayBuffer());
}
