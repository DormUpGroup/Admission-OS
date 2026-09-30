"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { DeleteLeadButton } from "@/components/admin/delete-lead-button";
import { promoteLeadToStudentAction } from "@/server/inbox-actions";

export function LeadRowMenu({
  leadId,
  name,
  conversationId,
}: {
  leadId: string;
  name: string;
  conversationId: string | null;
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function promote() {
    if (!conversationId || pending) return;
    setPending(true);
    setError("");
    void promoteLeadToStudentAction(conversationId)
      .then((result) => {
        router.push(`/admin/students/${result.studentId}`);
        router.refresh();
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Не удалось сделать учеником");
      })
      .finally(() => setPending(false));
  }

  return (
    <div className="flex flex-col items-end">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`Действия: ${name}`}
            aria-busy={pending}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-40 min-w-[11.5rem] rounded-xl border border-border bg-card p-1 shadow-lg"
          >
            <DropdownMenu.Item
              className="cursor-pointer select-none rounded-lg px-3 py-2 text-[13px] text-[var(--danger-fg)] outline-none data-[highlighted]:bg-muted"
              onSelect={() => setDeleteOpen(true)}
            >
              Удалить
            </DropdownMenu.Item>
            <DropdownMenu.Item
              disabled={!conversationId || pending}
              className="cursor-pointer select-none rounded-lg px-3 py-2 text-[13px] outline-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-muted"
              onSelect={promote}
            >
              {pending ? "…" : "Сделать учеником"}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error ? (
        <p className="mt-1 max-w-[12rem] text-right text-[12px] text-[var(--danger-fg)]" role="alert">
          {error}
        </p>
      ) : null}
      <DeleteLeadButton
        leadId={leadId}
        name={name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        showTrigger={false}
      />
    </div>
  );
}
