import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { JourneyCuratorBlock } from "@/server/services/student-journey/types";

export function JourneyCurator({ curator }: { curator: JourneyCuratorBlock }) {
  return (
    <section className="surface-card px-5 py-5">
      {curator.assigned && curator.name ? (
        <>
          <p className="text-[17px] font-medium tracking-tight text-foreground">
            Куратор: {curator.name}
          </p>
          {curator.responseHint ? (
            <p className="mt-1 text-[15px] text-muted-foreground">
              {curator.responseHint}
            </p>
          ) : (
            <p className="mt-1 text-[15px] text-muted-foreground">
              Можно написать, если нужен совет по следующему шагу.
            </p>
          )}
        </>
      ) : (
        <p className="text-[15px] text-muted-foreground">{curator.emptyMessage}</p>
      )}
      <div className="mt-3">
        {curator.assigned ? (
          <Button asChild variant="outline" size="lg">
            <Link href={curator.writeHref}>Написать куратору</Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" size="lg" disabled>
            Написать куратору
          </Button>
        )}
      </div>
    </section>
  );
}
