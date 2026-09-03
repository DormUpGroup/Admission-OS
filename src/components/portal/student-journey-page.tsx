import Link from "next/link";
import { Button } from "@/components/ui/button";
import { JourneyCurator } from "@/components/portal/journey-curator";
import { JourneyDocuments } from "@/components/portal/journey-documents";
import { JourneyNow } from "@/components/portal/journey-now";
import { JourneyPrograms } from "@/components/portal/journey-programs";
import { JourneyRoute } from "@/components/portal/journey-route";
import type { StudentJourneyView } from "@/server/services/student-journey";

export function StudentJourneyPage({ view }: { view: StudentJourneyView }) {
  return (
    <div className="space-y-10 md:space-y-12">
      <section className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-[28px] font-semibold tracking-tight">Мой путь</h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            {view.headline}
          </p>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href={view.primaryCta.href}>{view.primaryCta.label}</Link>
        </Button>
      </section>

      <JourneyRoute stages={view.stages} />
      <JourneyNow tasks={view.nowTasks} emptyMessage={view.nowEmptyMessage} />
      <JourneyPrograms programs={view.programs} />
      {view.documents ? <JourneyDocuments documents={view.documents} /> : null}
      <JourneyCurator curator={view.curator} />
    </div>
  );
}
