import Link from "next/link";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { QuestionnaireProgramsForm } from "@/components/questionnaire-programs-form";

export default async function AdminProgramsQuestionnairePreviewPage() {
  await requireRole(["ADMIN"]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Анкета №2"
          description="Пустой стартовый вид анкеты по подбору программ"
        />
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/programs">← К программам</Link>
        </Button>
      </div>

      <QuestionnaireProgramsForm preview />
    </div>
  );
}
