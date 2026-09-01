/**
 * Re-exports questionnaire direction ↔ MIUR mapping from the catalog.
 * Source of truth: `@/lib/program-directions`.
 */
export {
  PROGRAM_DIRECTIONS,
  QUESTIONNAIRE_DIRECTION_MIUR,
  MAPPED_QUESTIONNAIRE_DIRECTIONS,
  miurForDirectionLabel,
  type MiurClasseByLevel,
  type ProgramDirection,
} from "@/lib/program-directions";
