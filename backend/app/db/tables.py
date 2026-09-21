"""Read models for the existing Prisma-owned schema.

These tables intentionally mirror only the first migrated read domain. Alembic
does not own them yet: Prisma remains the schema owner until the final database
migration phase.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, MetaData, String, Table

metadata = MetaData()

university_table = Table(
    "University",
    metadata,
    Column("id", String, primary_key=True),
    Column("name", String, nullable=False),
    Column("slug", String, nullable=False),
    Column("city", String),
    Column("region", String),
    Column("country", String),
    Column("publicPrivate", String),
    Column("website", String),
)

program_table = Table(
    "Program",
    metadata,
    Column("id", String, primary_key=True),
    Column("universityId", String, ForeignKey("University.id"), nullable=False),
    Column("name", String, nullable=False),
    Column("slug", String, nullable=False),
    Column("degreeLevel", String, nullable=False),
    Column("field", String),
    Column("language", String),
    Column("active", Boolean, nullable=False),
)

application_table = Table(
    "Application",
    metadata,
    Column("id", String, primary_key=True),
    Column("studentId", String, ForeignKey("Student.id"), nullable=False),
    Column("programId", String, ForeignKey("Program.id"), nullable=False),
    Column("programAcademicYearId", String),
    Column("status", String, nullable=False),
    Column("intake", String, nullable=False),
    Column("applicationRound", String),
    Column("hardDeadline", DateTime(timezone=True)),
    Column("targetSubmissionDate", DateTime(timezone=True)),
    Column("readinessPercent", Integer, nullable=False),
    Column("riskLevel", String, nullable=False),
    Column("submittedAt", DateTime(timezone=True)),
    Column("applicationIdExternal", String),
    Column("submissionConfirmationNote", String),
    Column("applicationFeePaid", Boolean, nullable=False),
    Column("createdAt", DateTime(timezone=True), nullable=False),
    Column("updatedAt", DateTime(timezone=True), nullable=False),
)

requirement_table = Table(
    "Requirement",
    metadata,
    Column("id", String, primary_key=True),
    Column("applicationId", String, ForeignKey("Application.id"), nullable=False),
    Column("name", String, nullable=False),
    Column("type", String, nullable=False),
    Column("status", String, nullable=False),
    Column("isCritical", Boolean, nullable=False),
    Column("relatedDocumentId", String),
    Column("dueDate", DateTime(timezone=True)),
    Column("createdAt", DateTime(timezone=True), nullable=False),
)

student_table = Table(
    "Student",
    metadata,
    Column("id", String, primary_key=True),
    Column("firstName", String, nullable=False),
    Column("lastName", String, nullable=False),
    Column("email", String, nullable=False),
    Column("userId", String),
    Column("curatorId", String),
    Column("status", String, nullable=False),
    Column("journeyStage", String, nullable=False),
    Column("riskLevel", String, nullable=False),
    Column("intake", String, nullable=False),
    Column("targetField", String),
    Column("preferredLanguage", String),
    Column("nextActionJson", String),
    Column("studyLevel", String, nullable=False),
    Column("country", String),
)

user_table = Table(
    "User",
    metadata,
    Column("id", String, primary_key=True),
    Column("name", String, nullable=False),
    Column("role", String, nullable=False),
)

task_table = Table(
    "Task",
    metadata,
    Column("id", String, primary_key=True),
    Column("title", String, nullable=False),
    Column("description", String),
    Column("status", String, nullable=False),
    Column("priority", String, nullable=False),
    Column("assigneeId", String),
    Column("studentId", String, ForeignKey("Student.id"), nullable=False),
    Column("applicationId", String),
    Column("documentId", String),
    Column("dueDate", DateTime(timezone=True)),
    Column("isStudentFacing", Boolean, nullable=False),
    Column("completedAt", DateTime(timezone=True)),
    Column("createdAt", DateTime(timezone=True), nullable=False),
    Column("updatedAt", DateTime(timezone=True), nullable=False),
)

activity_table = Table(
    "Activity",
    metadata,
    Column("id", String, primary_key=True),
    Column("type", String, nullable=False),
    Column("studentId", String, ForeignKey("Student.id"), nullable=False),
    Column("applicationId", String),
    Column("userId", String),
    Column("metadata", String),
    Column("createdAt", DateTime(timezone=True), nullable=False),
)

document_table = Table(
    "Document",
    metadata,
    Column("id", String, primary_key=True),
    Column("studentId", String, ForeignKey("Student.id"), nullable=False),
    Column("name", String, nullable=False),
    Column("category", String, nullable=False),
    Column("status", String, nullable=False),
    Column("storagePath", String),
    Column("fileUrl", String),
    Column("uploadedAt", DateTime(timezone=True)),
    Column("reviewedAt", DateTime(timezone=True)),
    Column("reviewedById", String),
    Column("requestedAt", DateTime(timezone=True)),
    Column("studentFeedback", String),
    Column("updatedAt", DateTime(timezone=True), nullable=False),
    Column("createdAt", DateTime(timezone=True), nullable=False),
)

deadline_table = Table(
    "Deadline",
    metadata,
    Column("id", String, primary_key=True),
    Column("title", String, nullable=False),
    Column("date", DateTime(timezone=True), nullable=False),
    Column("type", String, nullable=False),
    Column("studentId", String, ForeignKey("Student.id"), nullable=False),
    Column("applicationId", String),
    Column("requirementId", String),
    Column("taskId", String),
    Column("isHardDeadline", Boolean, nullable=False),
    Column("isInternal", Boolean, nullable=False),
    Column("riskWeight", Integer, nullable=False),
    Column("createdAt", DateTime(timezone=True), nullable=False),
    Column("updatedAt", DateTime(timezone=True), nullable=False),
)

notification_table = Table(
    "InAppNotification",
    metadata,
    Column("id", String, primary_key=True),
    Column("userId", String, ForeignKey("User.id"), nullable=False),
    Column("studentId", String, ForeignKey("Student.id")),
    Column("type", String, nullable=False),
    Column("title", String, nullable=False),
    Column("body", String, nullable=False),
    Column("metadataJson", String),
    Column("readAt", DateTime(timezone=True)),
    Column("createdAt", DateTime(timezone=True), nullable=False),
)

program_academic_year_table = Table(
    "ProgramAcademicYear",
    metadata,
    Column("id", String, primary_key=True),
    Column("programId", String, ForeignKey("Program.id"), nullable=False),
    Column("academicYear", String, nullable=False),
)
