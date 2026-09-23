import { admissionDataYearNotice } from "@/server/services/student-journey/humanize";

export function AdmissionDataYearNotice({
  intake,
  dataYear,
  className,
}: {
  intake: string | null | undefined;
  dataYear?: string | null;
  className?: string;
}) {
  const text = admissionDataYearNotice(intake, dataYear);
  if (!text) return null;

  return (
    <div
      role="status"
      className={
        className ??
        "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
      }
    >
      {text}
    </div>
  );
}
