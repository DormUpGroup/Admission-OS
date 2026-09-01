import { Paperclip } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentStudent } from "@/server/auth/guards";
import { sendStudentMessageAction } from "@/server/actions";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import {
  MAX_MESSAGE_FILES,
  parseMessageAttachments,
  type MessageAttachment,
} from "@/lib/message-attachments";

type MessageMeta = {
  note?: string;
  channel?: string;
  from?: string;
  attachments?: unknown;
};

function parseMeta(raw: string | null): MessageMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as MessageMeta;
  } catch {
    return {};
  }
}

export default async function PortalMessagesPage() {
  const { session, student } = await getCurrentStudent();

  const curator = student.curatorId
    ? await prisma.user.findUnique({
        where: { id: student.curatorId },
        select: { name: true },
      })
    : null;

  const [activities, uploadedDocuments] = await Promise.all([
    prisma.activity.findMany({
      where: { studentId: student.id, type: "NOTE" },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    curator
      ? prisma.document.findMany({
          where: {
            studentId: student.id,
            fileUrl: { not: null },
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const messages = activities
    .map((activity) => {
      const meta = parseMeta(activity.metadata);
      if (meta.channel !== "student-curator") return null;
      const attachments = parseMessageAttachments(meta.attachments);
      const text = meta.note?.trim() ?? "";
      if (!text && attachments.length === 0) return null;
      const fromStudent =
        meta.from === "student" || activity.userId === session.user.id;
      return {
        id: activity.id,
        text,
        attachments,
        createdAt: activity.createdAt,
        fromStudent,
        author: fromStudent
          ? "Вы"
          : activity.user?.name || curator?.name || "Куратор",
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Сообщения</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {curator
            ? `Переписка с куратором ${curator.name}`
            : "Мы назначим куратора после обработки анкеты"}
        </p>
      </div>

      {messages.length === 0 ? (
        <EmptyState
          title="Пока нет сообщений"
          description="Напишите куратору, если есть вопрос по поступлению."
        />
      ) : (
        <ul className="space-y-3">
          {messages.map((message) => (
            <li
              key={message.id}
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
            >
              <p className="text-xs text-muted-foreground">
                {message.author} · {formatDate(message.createdAt)}
              </p>
              {message.text ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                  {message.text}
                </p>
              ) : null}
              {message.attachments.length > 0 ? (
                <AttachmentList attachments={message.attachments} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {curator ? (
        <form
          action={sendStudentMessageAction}
          encType="multipart/form-data"
          className="space-y-4"
        >
          <label className="block">
            <span className="sr-only">Сообщение куратору</span>
            <textarea
              name="message"
              rows={4}
              maxLength={2000}
              placeholder="Напишите куратору"
              className="min-h-28 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            />
          </label>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--foreground)]">
              <Paperclip className="h-3.5 w-3.5" />
              Прикрепить документы
            </p>
            <Input
              type="file"
              name="files"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
              className="h-11 file:mr-2 sm:h-9"
            />
            <p className="text-xs text-muted-foreground">
              PDF, фото или Word. До {MAX_MESSAGE_FILES} файлов, каждый не
              больше 10 МБ.
            </p>
          </div>

          {uploadedDocuments.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-[var(--foreground)]">
                Или выберите из уже загруженных
              </legend>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {uploadedDocuments.map((doc) => (
                  <li key={doc.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        name="documentId"
                        value={doc.id}
                        className="h-4 w-4 accent-[var(--brand)]"
                      />
                      <span className="min-w-0 truncate">{doc.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          <Button type="submit" size="lg" className="h-11 w-full sm:h-9 sm:w-auto">
            Отправить
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: MessageAttachment[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {attachments.map((file) => (
        <li key={`${file.fileUrl}-${file.name}`}>
          <a
            href={file.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 text-sm text-[var(--brand)] hover:underline"
          >
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{file.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
