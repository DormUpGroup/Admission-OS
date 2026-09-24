import { redirect } from "next/navigation";

export default async function AdminMessagesIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const { studentId } = await searchParams;
  if (studentId?.trim()) {
    redirect(`/admin/messages/site?studentId=${encodeURIComponent(studentId.trim())}`);
  }
  redirect("/admin/messages/site");
}
