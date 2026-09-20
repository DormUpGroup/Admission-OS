# IMMIGROME Admissions OS

Internal admissions operations system for IMMIGROME agency.

> Student → Applications → Requirements → Documents → Tasks → Deadlines → Risk → Next Action

## Stack (V1)

- **Next.js 15** (App Router) + TypeScript + Tailwind
- **Prisma** + **Supabase Postgres** (session pooler)
- **Auth.js (NextAuth v5)** credentials auth with roles: `ADMIN`, `CURATOR`, `STUDENT`
- **Supabase Storage** for student documents (private bucket, served via `/api/files`)

## Quick start

```bash
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → login.

### Demo accounts (password: `password123`)

| Email | Role |
|-------|------|
| `anna@immigrome.local` | Curator |
| `admin@immigrome.local` | Admin |
| `alina.sokolova@student.local` | Student portal |

## Routes

- `/admin` — Curator dashboard (Needs Attention, KPIs, tasks, waiting, deadlines)
- `/admin/students` — Students + profile + applications + documents
- `/admin/documents` — Document review inbox
- `/admin/tasks`, `/admin/deadlines`, `/admin/applications`
- `/admin/universities`, `/admin/programs`, `/admin/team`
- `/portal` — Student portal (action required, upload, apps, deadlines)

## Core loop

Request document → student sees Action Required → upload → curator inbox → approve → requirement completed → readiness/risk/next action recalculated → activity logged.

## Scripts

- `npm run dev` — development server
- `npm run db:seed` — seed demo data
- `npm run db:reset` — reset DB + seed
- `npm run build` — production build

## Note on Supabase

`DATABASE_URL` points at the hosted Supabase session pooler. Student files go to a private Storage bucket and are served through `/api/files` after Auth.js access checks. Auth is still Auth.js, not Supabase Auth.
