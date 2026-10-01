# AOS

**Admissions Operations System that turns fragmented, repetitive agency work into structured and automated workflows.**

Admission OS is an internal platform built for an education consultancy working with students applying to universities in Italy.

The system brings together student operations, applications, documents, deadlines, communication, program research, and curator workflows in one operational layer.

Its main goal is simple:

> reduce manual coordination work without removing human control from decisions that require judgment.

---

## Problem

Admissions agencies manage a large number of interconnected processes:

- student onboarding and profile collection;
- consultations and qualification;
- university and program research;
- eligibility checks;
- program selection;
- applications;
- admission requirements;
- document collection and review;
- deadlines;
- student communication;
- reminders and follow-ups;
- curator tasks and next actions.

When these processes are handled across spreadsheets, chats, documents, university websites, and manual reminders, teams spend a significant amount of time coordinating information instead of actually working with students.

Admission OS turns these processes into connected workflows built around a shared student state.

---

## What the system does

Admission OS supports the admissions journey from the first interaction with a student to application and admission.

```text
Lead
  ↓
Consultation
  ↓
Student Profile
  ↓
Program Research
  ↓
Program Selection
  ↓
Applications
  ↓
Requirements
  ↓
Documents
  ↓
Deadlines & Tasks
  ↓
Submission / Admission
```

Instead of treating each step as an isolated record, the system connects them.

A change in one part of the process can create actions elsewhere — for example, a missing document can affect an application, trigger a student action, surface a curator task, or generate a reminder.

---

# Core Modules

## Student Operations

Each student has a central operational profile containing the information needed throughout the admission process.

This can include:

- academic background;
- preferences;
- assigned curator;
- current admission stage;
- applications;
- documents;
- deadlines;
- tasks;
- program selections;
- communication history;
- next actions.

The goal is to give curators one operational view instead of reconstructing context from multiple tools.

---

## Applications

Applications are tracked separately for each student and university program.

The application layer connects:

- admission requirements;
- documents;
- exams;
- deadlines;
- application status;
- tasks;
- missing information.

This allows the system to understand the current state of an application and surface what needs attention next.

---

## Documents

Admission OS includes document workflows for requesting, uploading, reviewing, and replacing student documents.

Documents are connected directly to admission requirements and applications rather than being stored as isolated files.

Typical workflows include:

```text
Document required
      ↓
Student action
      ↓
Upload
      ↓
Curator review
      ↓
Approved / Replacement requested
```

The platform supports private file storage and controlled access to student documents.

---

## Deadlines & Tasks

Deadlines and tasks are connected to the student journey.

They can be associated with:

- applications;
- admission requirements;
- document preparation;
- exams;
- university deadlines;
- internal actions.

The system is designed to help answer:

- What needs attention now?
- What is missing?
- What is blocking an application?
- What deadline is approaching?
- What should the student or curator do next?

---

## Communication

Student communication is connected to operational context rather than treated as a separate messaging system.

Admission OS supports communication workflows around different stages of the admission process, including:

- onboarding;
- missing information;
- document requests;
- reminders;
- application updates;
- consultations;
- follow-ups.

Automation can handle repetitive communication while allowing staff to take over when human interaction is more appropriate.

---

## Consultations

The platform also supports early-stage lead and consultation workflows.

This includes:

- consultation booking;
- curator assignment;
- appointment status;
- meeting information;
- pre-consultation communication.

Leads can move through the initial consultation process before becoming full student records.

---

# Program Intelligence

Program research and matching is one module within Admission OS.

Its purpose is to reduce the amount of manual research curators need to perform when identifying suitable university programs.

The system can support:

- program discovery;
- structured program data;
- admission requirements;
- application periods;
- language requirements;
- entrance exams;
- academic eligibility;
- program comparison;
- student-program matching.

Program information is linked back to source material so curators can verify important requirements before presenting options to students.

---

## Matching

The matching layer evaluates available program information against a student's academic profile and preferences.

It can surface:

- potentially suitable programs;
- eligibility issues;
- missing information;
- fit considerations;
- risks requiring curator review.

The system is intentionally human-in-the-loop.

Matching helps reduce research time, but the curator remains responsible for validating recommendations before they reach the student.

---

# Workflow Automation

Admission OS is built around workflow automation rather than isolated features.

A typical system pattern is:

```text
State change
     ↓
Workflow evaluation
     ↓
Action
     ↓
Updated operational state
```

Actions can include:

- creating tasks;
- requesting documents;
- sending reminders;
- updating application state;
- triggering background processing;
- surfacing items for curator review.

This allows repetitive operational work to happen automatically while keeping important decisions visible to staff.

---

# AI-Assisted Workflows

AI is used selectively where the input is too unstructured or context-dependent for simple deterministic logic.

Examples include:

- extracting structured information from university sources;
- interpreting admission requirements;
- assisting program evaluation;
- processing unstructured student or program information;
- supporting selected communication workflows.

The system does not treat AI output as unquestionable truth.

Important actions remain reviewable, and workflows are designed so deterministic application state remains the source of truth.

---

# Human-in-the-Loop

Admission processes contain decisions that should not be fully automated.

Admission OS therefore keeps human review inside critical workflows.

```text
Automation / AI
      ↓
Proposed result
      ↓
Curator review
      ↓
Approved action
```

This approach is especially important for:

- program recommendations;
- admission requirement interpretation;
- document approval;
- student-facing decisions;
- actions with external consequences.

Automation removes repetitive work.

Humans remain responsible for judgment.

---

# High-Level Architecture

```text
                ┌────────────────────┐
                │   Student Portal   │
                └─────────┬──────────┘
                          │
                ┌─────────▼──────────┐
                │   Web Application  │
                │                    │
                │ Curator / Admin UI │
                │ Student Workflows  │
                │ APIs               │
                └─────────┬──────────┘
                          │
                ┌─────────▼──────────┐
                │  Operational Data │
                │                    │
                │ Students           │
                │ Applications       │
                │ Documents          │
                │ Deadlines          │
                │ Tasks              │
                │ Programs           │
                │ Communication      │
                └─────────┬──────────┘
                          │
                ┌─────────▼──────────┐
                │ Workflow Layer     │
                │                    │
                │ Background jobs    │
                │ Automation         │
                │ AI workflows       │
                └───────┬───────┬────┘
                        │       │
                        ▼       ▼
                    External   Human
                    Services   Review
```

---

# Engineering Principles

## Shared operational state

The platform keeps admissions state in one system rather than spreading workflow logic across independent tools.

---

## Workflow-driven architecture

Features are designed around real operational processes instead of isolated CRUD screens.

---

## Automation with boundaries

Automation handles repetitive coordination while higher-risk actions remain visible and reviewable.

---

## Source-grounded data

Important program and admission information can remain connected to the source it came from.

---

## Background processing

Long-running or external operations can be handled outside the main application request cycle.

---

## Reliability

Workflow execution is designed with failure handling, retries, and traceable state in mind.

---

# Tech Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS

### Backend & Data

- PostgreSQL
- Prisma ORM
- Supabase
- Next.js APIs

### Authentication & Storage

- Auth.js
- role-based access
- private file storage

### Automation

- background workers
- event-driven workflows
- external integrations

### AI & Data Processing

- OpenAI API
- document parsing
- PDF processing
- OCR

### Testing

- Vitest
- workflow and matching evaluation tooling

### Infrastructure

- Railway
- Supabase

---

# Product Philosophy

Admission OS is based on one central principle:

> **Automate the coordination layer of admissions operations while keeping humans responsible for decisions that require judgment.**

The objective is not to build a fully autonomous admissions agent.

The objective is to build an operational system where software, automation, AI, and human expertise work together around the same source of truth.

---

## Status

Admission OS is an actively developed internal product used to automate and improve real admissions workflows.

The repository contains the application, workflow infrastructure, admissions domain model, program intelligence modules, automation logic, and supporting tooling.
