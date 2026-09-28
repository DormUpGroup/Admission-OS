/** In-app text for a curator when automation stops and a person must act. */
export function formatCuratorAutomationNotice(input: {
  clientName?: string | null;
  problem: string;
  action: string;
}): { title: string; body: string } {
  const who = input.clientName?.trim();
  return {
    title: "Автоматика остановилась",
    body: [
      who ? `Клиент: ${who}.` : null,
      `Проблема: ${input.problem.trim()}`,
      `Действие: ${input.action.trim()}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
