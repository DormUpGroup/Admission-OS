import { getCurrentStudent } from "@/server/auth/guards";
import { loadStudentJourney } from "@/server/services/student-journey";
import { StudentJourneyPage } from "@/components/portal/student-journey-page";

export default async function PortalHomePage() {
  const { student } = await getCurrentStudent();
  const view = await loadStudentJourney(student.id);
  return <StudentJourneyPage view={view} />;
}
