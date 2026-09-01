/** QA suite email list — safe to import without side effects. */
export const QA_SUITE_EMAILS = [
  ..."abcdefghijklmnopqrstuvwxy".split("").map((l) => `match-test-${l}@student.local`),
  "match-test-qa-med@student.local",
  "match-test-qa-dent@student.local",
  "match-test-qa-pharm@student.local",
  "match-test-qa-budget@student.local",
  "match-test-qa-nobudget@student.local",
  "match-test-qa-megamix@student.local",
  "match-test-qa-bothlang@student.local",
];
