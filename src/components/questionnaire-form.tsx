"use client";

import { useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type {
  QuestionnaireField,
  QuestionnaireSection,
} from "@/lib/questionnaire-personal";
import { Button } from "@/components/ui/button";

export type QuestionnaireAnswers = Record<string, string | string[] | undefined>;

function FieldCard({
  field,
  value,
  error,
  onChange,
}: {
  field: QuestionnaireField;
  value: string | string[] | undefined;
  error?: string;
  onChange: (next: string | string[]) => void;
}) {
  const textValue = typeof value === "string" ? value : "";
  const listValue = Array.isArray(value) ? value : [];
  const otherSelected =
    field.type === "radio_other" &&
    (textValue === "Other" || textValue.startsWith("Other:"));
  const otherText = textValue.startsWith("Other:")
    ? textValue.slice("Other:".length).trim()
    : "";

  return (
    <div
      className={cn(
        "surface-card rounded-[22px] border bg-card px-5 py-4",
        error ? "border-red-300" : "border-[var(--border)]"
      )}
    >
      <p className="text-sm font-medium text-[var(--foreground)]">
        {field.label}
        {field.required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </p>
      {field.hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p>
      ) : null}

      {field.type === "text" ? (
        <input
          type="text"
          value={textValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ваш ответ"
          className="mt-3 w-full border-0 border-b border-[var(--border)] bg-transparent px-0 py-2 text-sm outline-none focus:border-[var(--brand)]"
        />
      ) : null}

      {field.type === "textarea" ? (
        <textarea
          value={textValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ваш ответ"
          rows={3}
          className="mt-3 w-full resize-y rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
        />
      ) : null}

      {field.type === "date" ? (
        <div className="mt-3">
          <p className="mb-1 text-xs text-muted-foreground">Дата</p>
          <input
            type="date"
            value={textValue}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
          />
        </div>
      ) : null}

      {field.type === "radio" ? (
        <ul className="mt-3 space-y-2">
          {(field.options ?? []).map((opt) => (
            <li key={opt}>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="radio"
                  name={field.id}
                  checked={textValue === opt}
                  onChange={() => onChange(opt)}
                  className="mt-0.5"
                />
                <span>{opt}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      {field.type === "radio_other" ? (
        <ul className="mt-3 space-y-2">
          {(field.options ?? []).map((opt) => {
            const isOther = opt === "Other";
            const checked = isOther
              ? otherSelected
              : textValue === opt;
            return (
              <li key={opt}>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="radio"
                    name={field.id}
                    checked={checked}
                    onChange={() => onChange(isOther ? "Other:" : opt)}
                    className="mt-0.5"
                  />
                  <span className="flex flex-1 flex-wrap items-center gap-2">
                    {opt}
                    {isOther && otherSelected ? (
                      <input
                        type="text"
                        value={otherText}
                        onChange={(e) => onChange(`Other: ${e.target.value}`)}
                        placeholder="Ваш ответ"
                        className="min-w-[140px] flex-1 border-0 border-b border-[var(--border)] bg-transparent px-0 py-0.5 text-sm outline-none focus:border-[var(--brand)]"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      {field.type === "checkbox" ? (
        <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {(field.options ?? []).map((opt) => {
            const checked = listValue.includes(opt);
            return (
              <li key={opt}>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (checked) {
                        onChange(listValue.filter((v) => v !== opt));
                      } else {
                        onChange([...listValue, opt]);
                      }
                    }}
                    className="mt-0.5"
                  />
                  <span>{opt}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-red-600">(!) Это обязательный вопрос</p>
      ) : null}
    </div>
  );
}

function isEmptyValue(value: string | string[] | undefined) {
  if (value == null) return true;
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "" || t === "Other" || t === "Other:") return true;
    return false;
  }
  return value.length === 0;
}

export function QuestionnaireForm({
  title,
  subtitle,
  sections,
  initialAnswers = {},
  preview = false,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  sections: QuestionnaireSection[];
  initialAnswers?: QuestionnaireAnswers;
  preview?: boolean;
  onSubmit?: (answers: QuestionnaireAnswers) => Promise<void> | void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(initialAnswers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const section = sections[step];
  const isLast = step === sections.length - 1;
  const isFirst = step === 0;

  const progress = useMemo(
    () => Math.round(((step + 1) / sections.length) * 100),
    [step, sections.length]
  );

  function setField(id: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function validateSection(): boolean {
    const nextErrors: Record<string, string> = {};
    for (const field of section.fields) {
      if (!field.required) continue;
      if (isEmptyValue(answers[field.id])) nextErrors[field.id] = "required";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function clearForm() {
    setAnswers({});
    setErrors({});
    setStep(0);
  }

  function goNext() {
    if (preview) {
      if (!isLast) setStep((s) => s + 1);
      return;
    }
    if (!validateSection()) return;
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    if (!onSubmit) return;
    startTransition(async () => {
      await onSubmit(answers);
    });
  }

  function goBack() {
    setErrors({});
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="overflow-hidden surface-card">
        <div className="px-5 py-5">
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">{subtitle}</p>
          {preview ? (
            <p className="mt-2 text-[13px] font-medium text-[var(--brand)]">
              Пустой стартовый вид · только просмотр
            </p>
          ) : null}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[var(--brand)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="rounded-full bg-muted px-4 py-2.5 text-[15px] font-semibold text-foreground">
        {section.title}
      </div>

      <div className="space-y-3">
        {section.fields.map((field) => (
          <FieldCard
            key={field.id}
            field={field}
            value={answers[field.id]}
            error={errors[field.id]}
            onChange={(next) => setField(field.id, next)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex gap-2">
          {!isFirst ? (
            <Button type="button" variant="outline" onClick={goBack}>
              Назад
            </Button>
          ) : null}
          <Button type="button" onClick={goNext} disabled={pending}>
            {preview
              ? isLast
                ? "Конец формы"
                : "Далее"
              : isLast
                ? pending
                  ? "Сохранение…"
                  : "Отправить"
                : "Далее"}
          </Button>
        </div>
        <button
          type="button"
          onClick={clearForm}
          className="text-sm text-[var(--brand)] hover:underline"
        >
          Очистить форму
        </button>
      </div>
    </div>
  );
}
