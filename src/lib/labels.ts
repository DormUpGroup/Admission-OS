/** Russian UI labels for enums and shared copy */

export const STATUS_LABELS: Record<string, string> = {
  // Student
  ACTIVE: "Активен",
  PAUSED: "На паузе",
  COMPLETED: "Завершён",
  ARCHIVED: "В архиве",
  // Application
  SELECTED: "Выбрана",
  PREPARING: "Подготовка",
  READY_FOR_REVIEW: "Готово к проверке",
  READY_TO_SUBMIT: "Готово к подаче",
  SUBMITTED: "Подана",
  WAITING_RESULT: "Ожидание результата",
  ADDITIONAL_DOCUMENTS: "Доп. документы",
  ADMITTED: "Зачислен",
  REJECTED: "Отказ",
  WAITLISTED: "Лист ожидания",
  NOT_SELECTED: "Не выбрана",
  ENROLLED: "Оформлен",
  // Requirement / Document
  MISSING: "Отсутствует",
  REQUESTED: "Запрошен",
  UPLOADED: "Загружен",
  UNDER_REVIEW: "На проверке",
  APPROVED: "Одобрен",
  NEEDS_CHANGES: "Нужны правки",
  EXPIRED: "Истёк",
  BLOCKED: "Заблокирован",
  NOT_APPLICABLE: "Не применимо",
  // Task
  TODO: "К выполнению",
  IN_PROGRESS: "В работе",
  WAITING: "Ожидание",
  DONE: "Готово",
  // Priority
  LOW: "Низкий",
  MEDIUM: "Средний",
  HIGH: "Высокий",
  URGENT: "Срочный",
  // Risk
  NONE: "Нет",
  CRITICAL: "Критический",
  // Study
  BACHELOR: "Бакалавриат",
  MASTER: "Магистратура",
  SINGLE_CYCLE: "Цикл единственный",
  FOUNDATION: "Foundation year",
  PHD: "Аспирантура",
  OTHER: "Другое",
  ELIGIBLE: "Подходит",
  LIKELY_ELIGIBLE: "Скорее подходит",
  NEEDS_REVIEW: "На проверке",
  NOT_ELIGIBLE: "Не подходит",
  AUTO_MATCHED: "Автоподбор",
  SHORTLISTED: "В коротком списке",
  // Journey
  PROFILE: "Профиль",
  STRATEGY: "Стратегия",
  PROGRAMS: "Программы",
  APPLICATIONS: "Подачи",
  ADMISSION: "Поступление",
  ENROLLMENT: "Зачисление",
  // Roles
  ADMIN: "Админ",
  CURATOR: "Куратор",
  STUDENT: "Студент",
  // Categories
  PERSONAL: "Личные",
  EDUCATION: "Образование",
  LANGUAGE: "Язык",
  EXAMS: "Экзамены",
  // Requirement types
  DOCUMENT: "Документ",
  EXAM: "Экзамен",
  TASK: "Задача",
  PAYMENT: "Оплата",
};

export const RISK_LABELS: Record<string, string> = {
  NONE: "Нет",
  LOW: "Низкий",
  MEDIUM: "Средний",
  HIGH: "Высокий",
  CRITICAL: "Критический",
};

export const JOURNEY_LABELS: Record<string, string> = {
  PROFILE: "Профиль",
  STRATEGY: "Стратегия",
  PROGRAMS: "Программы",
  APPLICATIONS: "Подачи",
  ADMISSION: "Поступление",
  ENROLLMENT: "Зачисление",
  COMPLETED: "Завершено",
};

export const APPLICANT_CATEGORY_LABELS: Record<string, string> = {
  EU_CITIZEN: "Гражданин ЕС",
  EU_EQUIVALENT: "Приравнен к ЕС",
  NON_EU_RESIDENT_ITALY: "Non-EU, резидент Италии",
  NON_EU_RESIDENT_ABROAD: "Non-EU из-за рубежа",
  ALL: "Все категории",
  UNKNOWN: "Не указано",
};

export const PROGRAMME_FACT_FIELD_LABELS: Record<string, string> = {
  ACCESS_TYPE: "Доступ и набор",
  SELECTION: "Тип отбора",
  APPLICATION_DEADLINE: "Дедлайн подачи",
  TUITION: "Стоимость",
  SEATS: "Места",
  ADMISSION_EXAMS: "Вступительные экзамены",
  LANGUAGE_REQUIREMENT: "Языковое требование",
  REQUIRED_DOCUMENTS: "Необходимые документы",
  CAMPUS: "Кампус",
  ENRICHMENT_TRACE: "Трассировка обогащения",
  FIELD_STATUS: "Статус полей",
};

export const FACT_ORIGIN_LABELS: Record<string, string> = {
  AI: "AI",
  OFFICIAL_FALLBACK: "офисье / сайт",
  MANUAL_VERIFIED: "подтверждено вручную",
  LEGACY_CANDIDATE: "каталог",
  DISCOVERY: "поиск",
};

export const FACT_FRESHNESS_LABELS: Record<string, string> = {
  current: "актуально",
  indicative: "ориентир",
  unknown: "неизвестно",
  CURRENT: "актуально",
  INDICATIVE: "ориентир",
  UNKNOWN: "неизвестно",
};

export const FACT_CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "высокая",
  MEDIUM: "средняя",
  LOW: "низкая",
  UNKNOWN: "неизвестно",
};

export function labelOf(value: string | null | undefined, map: Record<string, string> = STATUS_LABELS) {
  if (!value) return "—";
  return map[value] ?? value.replaceAll("_", " ");
}

/** Never leak underscore enums; unknown → «Не указано». */
export function labelApplicantCategory(
  value: string | null | undefined
): string {
  if (!value) return APPLICANT_CATEGORY_LABELS.UNKNOWN;
  return APPLICANT_CATEGORY_LABELS[value] ?? APPLICANT_CATEGORY_LABELS.UNKNOWN;
}

export function labelFactField(value: string | null | undefined): string {
  if (!value) return "Поле";
  return PROGRAMME_FACT_FIELD_LABELS[value] ?? "Другое поле";
}

export function labelFactOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  return FACT_ORIGIN_LABELS[value] ?? null;
}

export function labelFactFreshness(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  return FACT_FRESHNESS_LABELS[value] ?? null;
}

export function labelFactConfidence(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  return FACT_CONFIDENCE_LABELS[value] ?? null;
}
