"use client";

import { QuestionnaireForm } from "@/components/questionnaire-form";
import {
  PROGRAMS_QUESTIONNAIRE_SECTIONS,
  PROGRAMS_QUESTIONNAIRE_SUBTITLE,
  PROGRAMS_QUESTIONNAIRE_TITLE,
  type ProgramsQuestionnaireAnswers,
} from "@/lib/questionnaire-programs";

export function QuestionnaireProgramsForm({
  initialAnswers = {},
  preview = false,
  onSubmit,
}: {
  initialAnswers?: ProgramsQuestionnaireAnswers;
  preview?: boolean;
  onSubmit?: (answers: ProgramsQuestionnaireAnswers) => Promise<void> | void;
}) {
  return (
    <QuestionnaireForm
      title={PROGRAMS_QUESTIONNAIRE_TITLE}
      subtitle={PROGRAMS_QUESTIONNAIRE_SUBTITLE}
      sections={PROGRAMS_QUESTIONNAIRE_SECTIONS}
      initialAnswers={initialAnswers}
      preview={preview}
      onSubmit={onSubmit}
    />
  );
}
