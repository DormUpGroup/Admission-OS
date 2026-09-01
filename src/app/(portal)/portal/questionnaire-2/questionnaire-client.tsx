"use client";

import { useRouter } from "next/navigation";
import { QuestionnaireProgramsForm } from "@/components/questionnaire-programs-form";
import { saveProgramsQuestionnaireAction } from "@/server/actions";
import type { ProgramsQuestionnaireAnswers } from "@/lib/questionnaire-programs";

export function PortalProgramsQuestionnaireClient({
  initialAnswers,
}: {
  initialAnswers: ProgramsQuestionnaireAnswers;
}) {
  const router = useRouter();

  return (
    <QuestionnaireProgramsForm
      initialAnswers={initialAnswers}
      onSubmit={async (answers) => {
        await saveProgramsQuestionnaireAction(answers);
        router.push("/portal/programs");
        router.refresh();
      }}
    />
  );
}
