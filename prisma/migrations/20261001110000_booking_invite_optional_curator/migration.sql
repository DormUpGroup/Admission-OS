-- Guest booking no longer needs a curator assigned up front. The shared
-- Google Calendar holds the slot; Meet email goes to the guest and the
-- calendar subject (admin) when no curator is on the invite.

ALTER TABLE "BookingInvite" ALTER COLUMN "curatorId" DROP NOT NULL;
