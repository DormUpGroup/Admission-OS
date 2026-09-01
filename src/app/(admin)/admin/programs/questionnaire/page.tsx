import Link from "next/link";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { QuestionnairePersonalForm } from "@/components/questionnaire-personal-form";

export default async function AdminQuestionnairePreviewPage() {
  await requireRole(["ADMIN"]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Анкета №1"
          description="Пустой стартовый вид анкеты по личной информации"
        />
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/programs">← К программам</Link>
        </Button>
      </div>

      <QuestionnairePersonalForm preview />
    </div>
  );
}
