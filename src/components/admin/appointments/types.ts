export type AppointmentSlotDto = {
  key: string;
  startsAt: string;
  endsAt: string;
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
