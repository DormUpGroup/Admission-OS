"use client";

import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";

export type ProgramMatchTabStatus = "running" | "done" | "idle";

const RUNNING_POLL_MS = 1500;
const IDLE_POLL_MS = 5000;

function statusFromJob(job: { status: string } | null): ProgramMatchTabStatus {
  if (!job) return "idle";
  if (job.status === "PENDING" || job.status === "RUNNING") return "running";
  if (job.status === "SUCCEEDED") return "done";
  return "idle";
}

export function ProgramMatchTabMark({
  studentId,
  initialStatus,
}: {
  studentId: string;
  initialStatus: ProgramMatchTabStatus;
}) {
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    setStatus(initialStatus);

    async function poll() {
      let next: ProgramMatchTabStatus = "idle";
      try {
        const response = await fetch(
          `/api/admin/students/${studentId}/generate-matches`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const body = (await response.json()) as { job: { status: string } | null };
          next = statusFromJob(body.job);
          if (!cancelled) setStatus(next);
        }
      } catch {
        next = status;
      }
      if (cancelled) return;
      timer = window.setTimeout(poll, next === "running" ? RUNNING_POLL_MS : IDLE_POLL_MS);
    }

    timer = window.setTimeout(poll, initialStatus === "running" ? RUNNING_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [studentId, initialStatus]);

  if (status === "running") {
    return (
      <Search
        className="h-3.5 w-3.5 shrink-0 animate-pulse text-[var(--brand)]"
        aria-label="Идёт подбор программ"
      />
    );
  }

  if (status === "done") {
    return (
      <Check
        className="h-3.5 w-3.5 shrink-0 text-[var(--ok-fg)]"
        aria-label="Подбор программ завершён"
      />
    );
  }

  return null;
}
