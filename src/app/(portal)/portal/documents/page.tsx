import { prisma } from "@/lib/db";
import { getCurrentStudent } from "@/server/auth/guards";
import { portalUploadAction } from "@/server/actions";
import { DocumentStatusBadge } from "@/components/document-status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";

const UPLOADABLE = new Set(["REQUESTED", "NEEDS_CHANGES", "MISSING"]);

export default async function PortalDocumentsPage() {
  const { student } = await getCurrentStudent();

  const documents = await prisma.document.findMany({
    where: { studentId: student.id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Документы</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Загрузите файлы, которые запросил куратор
        </p>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          title="Пока нет документов"
          description="Нужные документы появятся здесь."
        />
      ) : (
        <ul className="space-y-3">
          {documents.map((doc) => {
            const canUpload = UPLOADABLE.has(doc.status);
            return (
              <li
                key={doc.id}
                className="rounded-xl border border-neutral-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900">{doc.name}</p>
                    <p className="mt-0.5 text-xs text-neutral-400 capitalize">
                      {doc.category.toLowerCase()}
                      {doc.uploadedAt
                        ? ` · загружено ${formatDate(doc.uploadedAt)}`
                        : ""}
                    </p>
                  </div>
                  <DocumentStatusBadge status={doc.status} />
                </div>

                {doc.status === "NEEDS_CHANGES" && doc.studentFeedback ? (
                  <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                      Комментарий куратора
                    </p>
                    <p className="mt-0.5">{doc.studentFeedback}</p>
                  </div>
                ) : null}

                {doc.fileUrl && !canUpload ? (
                  <a
                    href={doc.fileUrl}
                    className="mt-2 inline-block text-xs text-sky-700 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть загруженный файл
                  </a>
                ) : null}

                {canUpload ? (
                  <form
                    action={portalUploadAction}
                    className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
                  >
                    <input type="hidden" name="documentId" value={doc.id} />
                    <Input
                      type="file"
                      name="file"
                      required
                      className="h-9 file:mr-2"
                    />
                    <Button type="submit" size="sm" className="shrink-0">
                      Загрузить
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
