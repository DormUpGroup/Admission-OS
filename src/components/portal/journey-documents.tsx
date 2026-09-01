import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { JourneyDocumentsBlock } from "@/server/services/student-journey/types";

export function JourneyDocuments({
  documents,
}: {
  documents: JourneyDocumentsBlock;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--foreground)]">
        Документы
      </h2>
      <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4">
        <p className="text-sm text-[var(--foreground)]">
          Готово {documents.approvedCount} из {documents.totalCount} документов
        </p>
        {documents.awaitingReviewCount > 0 ? (
          <p className="mt-1 text-sm text-[var(--warning-fg)]">
            {documents.awaitingReviewCount === 1
              ? "1 ожидает проверки"
              : `${documents.awaitingReviewCount} ожидают проверки`}
          </p>
        ) : null}
        <div className="mt-3">
          <Button asChild variant="outline" size="lg" className="h-11 sm:h-9">
            <Link href={documents.href}>Открыть документы</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
