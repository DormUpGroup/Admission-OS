export function accompanimentAcceptedActivity(input: {
  studentId: string;
  userId: string;
  intake: string;
}) {
  return {
    type: "ACCOMPANIMENT_ACCEPTED" as const,
    studentId: input.studentId,
    userId: input.userId,
    metadata: JSON.stringify({
      intake: input.intake,
      note: "Принят на сопровождение",
    }),
  };
}
