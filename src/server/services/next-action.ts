export type NextAction = {
  title: string;
  description: string;
  priority: number;
  kind:
    | "CRITICAL_BLOCKER"
    | "OVERDUE_TASK"
    | "DOCUMENT_REVIEW"
    | "WAITING_ON_STUDENT"
    | "UPCOMING_DEADLINE"
    | "NORMAL_TASK"
    | "NONE";
  studentId: string;
  applicationId?: string | null;
  documentId?: string | null;
  taskId?: string | null;
  dueDate?: string | null;
};

export function emptyNextAction(studentId: string): NextAction {
  return {
    title: "Действий не требуется",
    description: "Студент идёт по плану.",
    priority: 99,
    kind: "NONE",
    studentId,
  };
}
