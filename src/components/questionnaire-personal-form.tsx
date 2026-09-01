"use client";

import { QuestionnaireForm } from "@/components/questionnaire-form";
import {
  PERSONAL_QUESTIONNAIRE_SECTIONS,
  PERSONAL_QUESTIONNAIRE_SUBTITLE,
  PERSONAL_QUESTIONNAIRE_TITLE,
  type PersonalQuestionnaireAnswers,
} from "@/lib/questionnaire-personal";

export function QuestionnairePersonalForm({
  initialAnswers = {},
  preview = false,
  onSubmit,
}: {
  initialAnswers?: PersonalQuestionnaireAnswers;
  preview?: boolean;
  onSubmit?: (answers: PersonalQuestionnaireAnswers) => Promise<void> | void;
}) {
  return (
    <QuestionnaireForm
      title={PERSONAL_QUESTIONNAIRE_TITLE}
      subtitle={PERSONAL_QUESTIONNAIRE_SUBTITLE}
      sections={PERSONAL_QUESTIONNAIRE_SECTIONS}
      initialAnswers={initialAnswers}
      preview={preview}
      onSubmit={onSubmit}
    />
  );
}
