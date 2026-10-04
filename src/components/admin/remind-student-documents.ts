export type RemindDocumentItem = {
  documentId: string;
  label: string;
};

export function documentIdFromWaitingTaskId(taskId: string): string | null {
  const prefix = "WAITING_DOCUMENT:";
  if (!taskId.startsWith(prefix)) return null;
  const rest = taskId.slice(prefix.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const documentId = rest.slice(sep + 1).trim();
  return documentId || null;
}

export function remindLabelFromReason(reason: string): string {
  const upload = reason.match(/^ждём загрузку:\s*(.+)$/i);
  if (upload?.[1]) return upload[1].trim();
  const changes = reason.match(/^ждём правки:\s*(.+)$/i);
  if (changes?.[1]) return changes[1].trim();
  return reason.trim() || "Документ";
}
