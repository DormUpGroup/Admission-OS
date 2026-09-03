import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import {
  approveDocumentAction,
  needsChangesAction,
} from "@/server/actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DocumentStatusBadge } from "@/components/document-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import { cn, formatDate, fullName } from "@/lib/utils";
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Документы"
        description="Входящие загруженные документы на проверку"
      />

      <div className="flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/admin/documents?view=${v.key}`}
            className={cn(
              "rounded-xl px-2.5 py-1 text-xs font-medium transition-colors",
              view === v.key
                ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {v.label}
          </Link>
        ))}
      </div>

      {documents.length === 0 ? (
        <EmptyState
          title="Нет документов в этом виде"
          description="Загруженные файлы студентов появятся здесь для проверки."
        />
      ) : (
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Студент</DataTableHead>
              <DataTableHead>Документ</DataTableHead>
              <DataTableHead>Загружен</DataTableHead>
              <DataTableHead>Связано</DataTableHead>
              <DataTableHead>Статус</DataTableHead>
              <DataTableHead>Действие</DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {documents.map((doc) => {
              const related = [
                ...new Set(
                  doc.requirements.map(
                    (r) =>
                      `${r.application.program.university.name} — ${r.application.program.name}`
                  )
                ),
              ];
              const canReview =
                doc.status === "UPLOADED" || doc.status === "UNDER_REVIEW";

              return (
                <DataTableRow key={doc.id}>
                  <DataTableCell>
                    <Link
                      href={`/admin/students/${doc.studentId}`}
                      className="font-medium hover:underline"
                    >
                      {fullName(doc.student.firstName, doc.student.lastName)}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{doc.name}</span>
                      {doc.fileUrl ? (
                        <a
                          href={doc.fileUrl}
                          className="text-[11px] text-sky-700 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Открыть файл
                        </a>
                      ) : null}
                    </div>
                  </DataTableCell>
                  <DataTableCell className="tabular-nums text-muted-foreground">
                    {formatDate(doc.uploadedAt)}
                  </DataTableCell>
                  <DataTableCell className="max-w-[200px] text-xs text-muted-foreground">
                    {related.length ? related.join(", ") : "—"}
                  </DataTableCell>
                  <DataTableCell>
                    <DocumentStatusBadge status={doc.status} />
                  </DataTableCell>
                  <DataTableCell>
                    {canReview ? (
                      <div className="flex flex-col gap-2">
                        <form action={approveDocumentAction.bind(null, doc.id)}>
                          <Button type="submit" size="sm" variant="secondary">
                            Одобрить
                          </Button>
                        </form>
                        <form action={needsChangesAction} className="flex gap-1">
                          <input type="hidden" name="documentId" value={doc.id} />
                          <Input
                            name="reason"
                            placeholder="Причина…"
                            className="h-7 w-36"
                            required
                          />
                          <Button type="submit" size="sm" variant="outline">
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
                  </DataTableCell>
                </DataTableRow>
              );
            })}
          </DataTableBody>
        </DataTable>
      )}
    </div>
  );
}
