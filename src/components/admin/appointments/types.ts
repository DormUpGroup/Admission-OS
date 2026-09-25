export type AppointmentSlotDto = {
  key: string;
  startsAt: string;
  endsAt: string;
};

export type AppointmentSlotGridDto = AppointmentSlotDto & {
  status: "open" | "busy" | "past";
  busyLabel: string | null;
};

export type CalendarAppointmentDto = {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  pendingStartsAt: string | null;
  pendingEndsAt: string | null;
  subjectLabel: string;
  hasTelegram: boolean;
  googleEventId: string | null;
};

export type CalendarView = "day" | "week" | "month";
