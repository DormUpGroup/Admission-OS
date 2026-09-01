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
  ELIGIBLE: "Eligible",
  LIKELY_ELIGIBLE: "Likely eligible",
  NEEDS_REVIEW: "Needs review",
  NOT_ELIGIBLE: "Not eligible",
  AUTO_MATCHED: "Auto matched",
  SHORTLISTED: "Shortlist",
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

export function labelOf(value: string | null | undefined, map: Record<string, string> = STATUS_LABELS) {
  if (!value) return "—";
  return map[value] ?? value.replaceAll("_", " ");
}
