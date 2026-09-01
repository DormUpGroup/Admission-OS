import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { JourneyCuratorBlock } from "@/server/services/student-journey/types";

export function JourneyCurator({ curator }: { curator: JourneyCuratorBlock }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white px-4 py-5">
      {curator.assigned && curator.name ? (
        <>
          <p className="text-sm font-medium text-[var(--foreground)]">
            Куратор: {curator.name}
          </p>
          {curator.responseHint ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {curator.responseHint}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Можно написать, если нужен совет по следующему шагу.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{curator.emptyMessage}</p>
      )}
      <div className="mt-3">
        {curator.assigned ? (
          <Button asChild variant="outline" size="lg" className="h-11 sm:h-9">
            <Link href={curator.writeHref}>Написать куратору</Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 sm:h-9"
            disabled
          >
            Написать куратору
          </Button>
        )}
      </div>
    </section>
  );
}
