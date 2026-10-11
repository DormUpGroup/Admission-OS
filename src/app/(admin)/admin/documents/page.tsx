import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import {
  approveDocumentAction,
  needsChangesAction,
} from "@/server/actions";
import {
  DocumentsReviewTable,
  toDocumentReviewRow,
} from "@/components/admin/documents-review-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FilterPills } from "@/components/filter-pills";
import { DocumentStatusBadge } from "@/components/document-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, fullName } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

const VIEWS = [
  { key: "to_review", label: "На проверку" },
  { key: "needs_changes", label: "Нужны правки" },
  { key: "approved", label: "Одобренные" },
  { key: "all", label: "Все" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

function statusFilter(view: ViewKey): Prisma.DocumentWhereInput {
  switch (view) {
    case "to_review":
      return { status: { in: ["UPLOADED", "UNDER_REVIEW"] } };
    case "needs_changes":
      return { status: "NEEDS_CHANGES" };
    case "approved":
      return { status: "APPROVED" };
    default:
      return {};
  }
}

export default async function AdminDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireStaff();
  const params = await searchParams;
  const view = (
    VIEWS.some((v) => v.key === params.view) ? params.view : "to_review"
  ) as ViewKey;

  const scope = studentScopeWhere(session.user.id, session.user.role);

  const documents = await prisma.document.findMany({
    where: {
      student: scope,
      ...statusFilter(view),
    },
    include: {
      student: { select: { id: true, firstName: true, lastName: true } },
      requirements: {
        include: {
          application: {
            include: {
              program: { include: { university: true } },
            },
          },
        },
      },
    },
    orderBy: [{ uploadedAt: "desc" }, { updatedAt: "desc" }],
  });

  const rows = documents.map(toDocumentReviewRow);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Документы"
        description="Входящие загруженные документы на проверку"
      />

      <FilterPills
        activeId={view}
        items={VIEWS.map((v) => ({
          id: v.key,
          label: v.label,
          href: `/admin/documents?view=${v.key}`,
        }))}
      />

      {documents.length === 0 ? (
        <EmptyState
          title="Нет документов в этом виде"
          description="Загруженные файлы студентов появятся здесь для проверки."
        />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {documents.map((doc) => {
              const related = [
                ...new Set(
                  doc.requirements.map(
                    (r) =>
                      `${r.application.program.university.name} — ${r.application.program.name}`,
                  ),
                ),
              ];
              const canReview =
                doc.status === "UPLOADED" || doc.status === "UNDER_REVIEW";
              return (
                <li key={doc.id} className="surface-card space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{doc.name}</p>
                      <Link
                        href={`/admin/students/${doc.studentId}`}
                        className="text-[13px] text-muted-foreground hover:underline"
                      >
                        {fullName(doc.student.firstName, doc.student.lastName)}
                      </Link>
                    </div>
                    <DocumentStatusBadge status={doc.status} />
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {formatDate(doc.uploadedAt)}
                    {related.length ? ` · ${related.join(", ")}` : ""}
                  </p>
                  {doc.fileUrl ? (
                    <a
                      href={doc.fileUrl}
                      className="text-[13px] text-sky-700 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть файл
                    </a>
                  ) : null}
                  {canReview ? (
                    <div className="space-y-2">
                      <form action={approveDocumentAction.bind(null, doc.id)}>
                        <Button
                          type="submit"
                          size="sm"
                          variant="secondary"
                          className="w-full"
                        >
                          Одобрить
                        </Button>
                      </form>
                      <form
                        action={needsChangesAction}
                        className="flex flex-col gap-2"
                      >
                        <input type="hidden" name="documentId" value={doc.id} />
                        <Input name="reason" placeholder="Причина…" required />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          className="w-full"
                        >
                          Нужны правки
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <Link
                      href={`/admin/students/${doc.studentId}?tab=documents`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Открыть хранилище
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
            <DocumentsReviewTable rows={rows} />
          </div>
        </>
      )}
    </div>
  );
}
