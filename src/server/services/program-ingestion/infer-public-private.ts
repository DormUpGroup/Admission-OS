/**
 * PUBLIC vs PRIVATE for Italian universities.
 *
 * Universitaly does not expose a tipo-ateneo field, so we classify from the
 * official name. Private detection is an allowlist of MUR-recognized non-state
 * and telematic universities plus a few name phrases (libera / privata /
 * telematica). Everything else that looks like a university defaults to PUBLIC.
 *
 * MUR lists (non-statali 2026-01-23, telematiche 2023-02-08):
 * https://www.mur.gov.it/it/aree-tematiche/universita/le-universita/universita-non-statali-riconosciute
 * https://www.mur.gov.it/it/aree-tematiche/universita/le-universita/universita-telematiche
 */

export type PublicPrivateKind = "PUBLIC" | "PRIVATE" | "UNKNOWN";

/** Distinctive tokens for MUR non-state and telematic atenei. Checked first. */
const PRIVATE_NAME_PATTERNS: RegExp[] = [
  /privat/i,
  /telematic/i,
  /non[\s-]?statale/i,
  /libera\s+universit/i,
  /private\s+university/i,
  /free\s+university\s+of\s+bozen/i,
  /luiss/i,
  /lumsa/i,
  /\blum\b/i,
  /degennaro/i,
  /bocconi/i,
  /cattolica/i,
  /humanitas/i,
  /iulm/i,
  /\bliuc\b/i,
  /cattaneo/i,
  /link\s+campus/i,
  /camillus/i,
  /unicamillus/i,
  /suor\s+orsola/i,
  /benincasa/i,
  /vita-?salute/i,
  /san\s+raffaele/i,
  /bio-?medico/i,
  /\bkore\b/i,
  /gastronomiche/i,
  /\bunint\b/i,
  /internazionali\s+di\s+roma/i,
  /europea\s+di\s+roma/i,
  /universit[aà](?:\s+degli\s+studi)?\s+europea/i,
  /dante\s+alighieri/i,
  /neuromed/i,
  /unineuromed/i,
  /valle\s+d['’]?aosta/i,
  /univda/i,
  /e-?campus/i,
  /giustino\s+fortunato/i,
  /marconi/i,
  /uninettuno/i,
  /leonardo\s+da\s+vinci/i,
  /unidav/i,
  /cusano/i,
  /pegaso/i,
  /unitelma/i,
  /mercatorum/i,
  /\biul\b/i,
  /bozen/i,
  /john\s+cabot/i,
  /american\s+university\s+of\s+rome/i,
];

const PUBLIC_NAME_RE = /statale|politecnico|universit|university/i;

/**
 * Classify from a university name (Universitaly `nomeStruttura`, not a bando).
 */
export function inferPublicPrivateFromUniversityName(
  name: string | null | undefined
): PublicPrivateKind {
  const blob = (name ?? "").trim();
  if (!blob) return "UNKNOWN";
  if (PRIVATE_NAME_PATTERNS.some((re) => re.test(blob))) return "PRIVATE";
  if (PUBLIC_NAME_RE.test(blob)) return "PUBLIC";
  return "UNKNOWN";
}

/**
 * Classify from admission-call / page text. Only strong phrases — a long
 * document may mention another university by name.
 */
export function inferPublicPrivateFromDocumentText(
  text: string | null | undefined
): PublicPrivateKind {
  const blob = (text ?? "").trim();
  if (!blob) return "UNKNOWN";
  if (
    /universit[aà]\s+privata|private\s+university|telematic|libera\s+universit[aà]|non[\s-]?statale/i.test(
      blob
    )
  ) {
    return "PRIVATE";
  }
  if (
    /universit[aà]\s+statale|public\s+university|state\s+university/i.test(blob)
  ) {
    return "PUBLIC";
  }
  return "UNKNOWN";
}
