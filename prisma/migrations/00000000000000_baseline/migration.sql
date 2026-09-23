-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "applicationId" TEXT,
    "userId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionCycle" (
    "id" TEXT NOT NULL,
    "programAcademicYearId" TEXT NOT NULL,
    "roundName" TEXT NOT NULL DEFAULT 'Round 1',
    "applicationOpen" TIMESTAMP(3),
    "applicationDeadline" TIMESTAMP(3),
    "rankingDate" TIMESTAMP(3),
    "enrollmentDeadline" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "totalSeats" INTEGER,
    "euSeats" INTEGER,
    "nonEuSeats" INTEGER,
    "nonEuResidentAbroadSeats" INTEGER,
    "applicantCategory" TEXT,
    "notes" TEXT,

    CONSTRAINT "AdmissionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionRequirement" (
    "id" TEXT NOT NULL,
    "programAcademicYearId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "operator" TEXT,
    "valueJson" TEXT,
    "description" TEXT,
    "sourceFactId" TEXT,
    "hardExclusion" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AdmissionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "programAcademicYearId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SELECTED',
    "intake" TEXT NOT NULL,
    "applicationRound" TEXT,
    "admissionType" TEXT,
    "requiredExam" TEXT,
    "requiredEnglish" TEXT,
    "applicationFee" TEXT,
    "hardDeadline" TIMESTAMP(3),
    "targetSubmissionDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "applicationIdExternal" TEXT,
    "submissionConfirmationNote" TEXT,
    "applicationFeePaid" BOOLEAN NOT NULL DEFAULT false,
    "readinessPercent" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "programId" TEXT,
    "intake" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ApplicationTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "studentId" TEXT NOT NULL,
    "applicationId" TEXT,
    "requirementId" TEXT,
    "taskId" TEXT,
    "isHardDeadline" BOOLEAN NOT NULL DEFAULT false,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "riskWeight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'MISSING',
    "storagePath" TEXT,
    "fileUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "expiryDate" TIMESTAMP(3),
    "notesInternal" TEXT,
    "studentFeedback" TEXT,
    "requestedAt" TIMESTAMP(3),
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studentId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadataJson" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeCohort" (
    "id" TEXT NOT NULL,
    "intake" TEXT NOT NULL,
    "seatLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "titleOfficial" TEXT,
    "titleEnglish" TEXT,
    "degreeLevel" TEXT NOT NULL DEFAULT 'BACHELOR',
    "degreeClass" TEXT,
    "field" TEXT,
    "fieldTagsJson" TEXT,
    "language" TEXT,
    "teachingLanguagesJson" TEXT,
    "deliveryMode" TEXT,
    "durationYears" INTEGER,
    "ects" INTEGER,
    "campusCity" TEXT,
    "campusesJson" TEXT,
    "region" TEXT,
    "officialUrl" TEXT,
    "universitalyUrl" TEXT,
    "universitalyExternalId" TEXT,
    "aliasesJson" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramAcademicYear" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "applicationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "dataConfidence" TEXT NOT NULL DEFAULT 'LOW',
    "indicativeFromYear" TEXT,
    "accessMode" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "dossierEnrichedAt" TIMESTAMP(3),
    "lastMonitoringCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramAcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramChangeEvent" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "programId" TEXT,
    "programAcademicYearId" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramEnrichmentRun" (
    "id" TEXT NOT NULL,
    "programAcademicYearId" TEXT NOT NULL,
    "applicantCategory" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "sourceDocumentIdsJson" TEXT,
    "resolvedFactIdsJson" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'AI',
    "academicYear" TEXT,
    "resolverVersion" TEXT,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "quoteRejectCount" INTEGER NOT NULL DEFAULT 0,
    "reusedFromRunId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "ProgramEnrichmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramFact" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "programAcademicYearId" TEXT,
    "field" TEXT NOT NULL,
    "normalizedValueJson" TEXT NOT NULL,
    "rawValue" TEXT,
    "evidenceQuote" TEXT,
    "applicantCategoryScope" TEXT,
    "freshness" TEXT,
    "extractionMetadataJson" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'LEGACY_CANDIDATE',
    "dimensionKey" TEXT,
    "decisionStatus" TEXT NOT NULL DEFAULT 'LEGACY_CANDIDATE',
    "evidenceValidatedAt" TIMESTAMP(3),
    "resolverVersion" TEXT,
    "sourceDocumentId" TEXT,
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL,
    "academicYear" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "extractionMethod" TEXT NOT NULL DEFAULT 'MANUAL',
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "superseded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramMatch" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programAcademicYearId" TEXT NOT NULL,
    "eligibilityStatus" TEXT NOT NULL,
    "fitScore" INTEGER NOT NULL,
    "scoreBreakdownJson" TEXT,
    "requirementsSummaryJson" TEXT,
    "reasonsJson" TEXT,
    "risksJson" TEXT,
    "missingInformationJson" TEXT,
    "discoveryMetaJson" TEXT,
    "dataConfidence" TEXT NOT NULL DEFAULT 'LOW',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchingEngineVersion" TEXT NOT NULL,
    "curatorStatus" TEXT NOT NULL DEFAULT 'AUTO_MATCHED',
    "curatorNotes" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "monitoringSelected" BOOLEAN NOT NULL DEFAULT false,
    "monitoringSelectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MISSING',
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "relatedDocumentId" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScholarshipProgram" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScholarshipProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScholarshipRule" (
    "id" TEXT NOT NULL,
    "scholarshipProgramId" TEXT NOT NULL,
    "iseeThreshold" INTEGER,
    "ispeThreshold" INTEGER,
    "residencyNotes" TEXT,
    "internationalDocsJson" TEXT,
    "deadline" TIMESTAMP(3),
    "amountMin" INTEGER,
    "amountMax" INTEGER,
    "notes" TEXT,
    "sourceUrl" TEXT,

    CONSTRAINT "ScholarshipRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceAuthority" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "academicYear" TEXT,
    "universityId" TEXT,
    "programId" TEXT,
    "programAcademicYearId" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'html',
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "rawStoragePath" TEXT,
    "rawText" TEXT,
    "parserVersion" TEXT NOT NULL DEFAULT 'v1',
    "status" TEXT NOT NULL DEFAULT 'FETCHED',
    "extractionQuality" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocumentSection" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "heading" TEXT NOT NULL DEFAULT '',
    "sectionType" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceDocumentSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "country" TEXT,
    "nationality" TEXT,
    "studyLevel" TEXT NOT NULL DEFAULT 'BACHELOR',
    "intake" TEXT NOT NULL,
    "targetField" TEXT,
    "preferredLanguage" TEXT,
    "preferredCities" TEXT,
    "questionnaireAt" TIMESTAMP(3),
    "questionnairePersonalJson" TEXT,
    "questionnaireProgramsJson" TEXT,
    "questionnaireProgramsAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "journeyStage" TEXT NOT NULL DEFAULT 'PROFILE',
    "curatorId" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'NONE',
    "nextActionJson" TEXT,
    "accompanimentStatus" TEXT NOT NULL DEFAULT 'NONE',
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentShortlistItem" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programAcademicYearId" TEXT NOT NULL,
    "programMatchId" TEXT,
    "curatorNote" TEXT,
    "studentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "visibleToStudent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentShortlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" TEXT,
    "studentId" TEXT NOT NULL,
    "applicationId" TEXT,
    "documentId" TEXT,
    "dueDate" TIMESTAMP(3),
    "isStudentFacing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TuitionInfo" (
    "id" TEXT NOT NULL,
    "programAcademicYearId" TEXT NOT NULL,
    "minTuition" INTEGER,
    "maxTuition" INTEGER,
    "fixedTuition" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "incomeBased" BOOLEAN NOT NULL DEFAULT false,
    "internationalFlatTax" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sourceFactId" TEXT,

    CONSTRAINT "TuitionInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "University" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IT',
    "publicPrivate" TEXT,
    "website" TEXT,
    "universitalyExternalId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "University_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Activity_applicationId_idx" ON "Activity"("applicationId" ASC);

-- CreateIndex
CREATE INDEX "Activity_studentId_idx" ON "Activity"("studentId" ASC);

-- CreateIndex
CREATE INDEX "Activity_userId_idx" ON "Activity"("userId" ASC);

-- CreateIndex
CREATE INDEX "AdmissionCycle_programAcademicYearId_idx" ON "AdmissionCycle"("programAcademicYearId" ASC);

-- CreateIndex
CREATE INDEX "AdmissionRequirement_programAcademicYearId_idx" ON "AdmissionRequirement"("programAcademicYearId" ASC);

-- CreateIndex
CREATE INDEX "AdmissionRequirement_sourceFactId_idx" ON "AdmissionRequirement"("sourceFactId" ASC);

-- CreateIndex
CREATE INDEX "Application_programAcademicYearId_idx" ON "Application"("programAcademicYearId" ASC);

-- CreateIndex
CREATE INDEX "Application_programId_idx" ON "Application"("programId" ASC);

-- CreateIndex
CREATE INDEX "Application_studentId_idx" ON "Application"("studentId" ASC);

-- CreateIndex
CREATE INDEX "ApplicationTemplate_programId_idx" ON "ApplicationTemplate"("programId" ASC);

-- CreateIndex
CREATE INDEX "ApplicationTemplateItem_templateId_idx" ON "ApplicationTemplateItem"("templateId" ASC);

-- CreateIndex
CREATE INDEX "Deadline_applicationId_idx" ON "Deadline"("applicationId" ASC);

-- CreateIndex
CREATE INDEX "Deadline_requirementId_idx" ON "Deadline"("requirementId" ASC);

-- CreateIndex
CREATE INDEX "Deadline_studentId_idx" ON "Deadline"("studentId" ASC);

-- CreateIndex
CREATE INDEX "Deadline_taskId_idx" ON "Deadline"("taskId" ASC);

-- CreateIndex
CREATE INDEX "Document_reviewedById_idx" ON "Document"("reviewedById" ASC);

-- CreateIndex
CREATE INDEX "Document_studentId_idx" ON "Document"("studentId" ASC);

-- CreateIndex
CREATE INDEX "InAppNotification_studentId_idx" ON "InAppNotification"("studentId" ASC);

-- CreateIndex
CREATE INDEX "InAppNotification_userId_readAt_idx" ON "InAppNotification"("userId" ASC, "readAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "IntakeCohort_intake_key" ON "IntakeCohort"("intake" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Program_universityId_slug_key" ON "Program"("universityId" ASC, "slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProgramAcademicYear_programId_academicYear_key" ON "ProgramAcademicYear"("programId" ASC, "academicYear" ASC);

-- CreateIndex
CREATE INDEX "ProgramChangeEvent_sourceDocumentId_idx" ON "ProgramChangeEvent"("sourceDocumentId" ASC);

-- CreateIndex
CREATE INDEX "ProgramEnrichmentRun_programAcademicYearId_applicantCategor_idx" ON "ProgramEnrichmentRun"("programAcademicYearId" ASC, "applicantCategory" ASC, "sourceFingerprint" ASC, "promptVersion" ASC);

-- CreateIndex
CREATE INDEX "ProgramEnrichmentRun_status_idx" ON "ProgramEnrichmentRun"("status" ASC);

-- CreateIndex
CREATE INDEX "ProgramFact_programAcademicYearId_field_academicYear_applic_idx" ON "ProgramFact"("programAcademicYearId" ASC, "field" ASC, "academicYear" ASC, "applicantCategoryScope" ASC);

-- CreateIndex
CREATE INDEX "ProgramFact_programAcademicYearId_field_origin_decisionStat_idx" ON "ProgramFact"("programAcademicYearId" ASC, "field" ASC, "origin" ASC, "decisionStatus" ASC, "superseded" ASC);

-- CreateIndex
CREATE INDEX "ProgramFact_programId_idx" ON "ProgramFact"("programId" ASC);

-- CreateIndex
CREATE INDEX "ProgramFact_sourceDocumentId_idx" ON "ProgramFact"("sourceDocumentId" ASC);

-- CreateIndex
CREATE INDEX "ProgramMatch_monitoringSelected_idx" ON "ProgramMatch"("monitoringSelected" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProgramMatch_studentId_programAcademicYearId_key" ON "ProgramMatch"("studentId" ASC, "programAcademicYearId" ASC);

-- CreateIndex
CREATE INDEX "Requirement_applicationId_idx" ON "Requirement"("applicationId" ASC);

-- CreateIndex
CREATE INDEX "Requirement_relatedDocumentId_idx" ON "Requirement"("relatedDocumentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ScholarshipProgram_authority_academicYear_name_key" ON "ScholarshipProgram"("authority" ASC, "academicYear" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "ScholarshipRule_scholarshipProgramId_idx" ON "ScholarshipRule"("scholarshipProgramId" ASC);

-- CreateIndex
CREATE INDEX "SourceDocument_contentHash_idx" ON "SourceDocument"("contentHash" ASC);

-- CreateIndex
CREATE INDEX "SourceDocument_programAcademicYearId_idx" ON "SourceDocument"("programAcademicYearId" ASC);

-- CreateIndex
CREATE INDEX "SourceDocument_programId_idx" ON "SourceDocument"("programId" ASC);

-- CreateIndex
CREATE INDEX "SourceDocument_universityId_idx" ON "SourceDocument"("universityId" ASC);

-- CreateIndex
CREATE INDEX "SourceDocument_url_idx" ON "SourceDocument"("url" ASC);

-- CreateIndex
CREATE INDEX "SourceDocumentSection_contentHash_idx" ON "SourceDocumentSection"("contentHash" ASC);

-- CreateIndex
CREATE INDEX "SourceDocumentSection_sourceDocumentId_position_idx" ON "SourceDocumentSection"("sourceDocumentId" ASC, "position" ASC);

-- CreateIndex
CREATE INDEX "SourceDocumentSection_sourceDocumentId_sectionType_idx" ON "SourceDocumentSection"("sourceDocumentId" ASC, "sectionType" ASC);

-- CreateIndex
CREATE INDEX "Student_acceptedById_idx" ON "Student"("acceptedById" ASC);

-- CreateIndex
CREATE INDEX "Student_curatorId_idx" ON "Student"("curatorId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StudentShortlistItem_studentId_programAcademicYearId_key" ON "StudentShortlistItem"("studentId" ASC, "programAcademicYearId" ASC);

-- CreateIndex
CREATE INDEX "Task_applicationId_idx" ON "Task"("applicationId" ASC);

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId" ASC);

-- CreateIndex
CREATE INDEX "Task_documentId_idx" ON "Task"("documentId" ASC);

-- CreateIndex
CREATE INDEX "Task_studentId_idx" ON "Task"("studentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TuitionInfo_programAcademicYearId_key" ON "TuitionInfo"("programAcademicYearId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "University_slug_key" ON "University"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email" ASC);

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionCycle" ADD CONSTRAINT "AdmissionCycle_programAcademicYearId_fkey" FOREIGN KEY ("programAcademicYearId") REFERENCES "ProgramAcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionRequirement" ADD CONSTRAINT "AdmissionRequirement_programAcademicYearId_fkey" FOREIGN KEY ("programAcademicYearId") REFERENCES "ProgramAcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionRequirement" ADD CONSTRAINT "AdmissionRequirement_sourceFactId_fkey" FOREIGN KEY ("sourceFactId") REFERENCES "ProgramFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_programAcademicYearId_fkey" FOREIGN KEY ("programAcademicYearId") REFERENCES "ProgramAcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationTemplate" ADD CONSTRAINT "ApplicationTemplate_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationTemplateItem" ADD CONSTRAINT "ApplicationTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ApplicationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramAcademicYear" ADD CONSTRAINT "ProgramAcademicYear_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramChangeEvent" ADD CONSTRAINT "ProgramChangeEvent_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEnrichmentRun" ADD CONSTRAINT "ProgramEnrichmentRun_programAcademicYearId_fkey" FOREIGN KEY ("programAcademicYearId") REFERENCES "ProgramAcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramFact" ADD CONSTRAINT "ProgramFact_programAcademicYearId_fkey" FOREIGN KEY ("programAcademicYearId") REFERENCES "ProgramAcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramFact" ADD CONSTRAINT "ProgramFact_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramFact" ADD CONSTRAINT "ProgramFact_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramMatch" ADD CONSTRAINT "ProgramMatch_programAcademicYearId_fkey" FOREIGN KEY ("programAcademicYearId") REFERENCES "ProgramAcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramMatch" ADD CONSTRAINT "ProgramMatch_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_relatedDocumentId_fkey" FOREIGN KEY ("relatedDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipRule" ADD CONSTRAINT "ScholarshipRule_scholarshipProgramId_fkey" FOREIGN KEY ("scholarshipProgramId") REFERENCES "ScholarshipProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_programAcademicYearId_fkey" FOREIGN KEY ("programAcademicYearId") REFERENCES "ProgramAcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocumentSection" ADD CONSTRAINT "SourceDocumentSection_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_curatorId_fkey" FOREIGN KEY ("curatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentShortlistItem" ADD CONSTRAINT "StudentShortlistItem_programAcademicYearId_fkey" FOREIGN KEY ("programAcademicYearId") REFERENCES "ProgramAcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentShortlistItem" ADD CONSTRAINT "StudentShortlistItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TuitionInfo" ADD CONSTRAINT "TuitionInfo_programAcademicYearId_fkey" FOREIGN KEY ("programAcademicYearId") REFERENCES "ProgramAcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
