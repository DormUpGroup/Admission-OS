import type { ProgramSourceAdapter } from "./base";

/** CISIA — general TOLC information only; programme-specific TOLC must come from university call. */
export const cisiaAdapter: ProgramSourceAdapter = {
  name: "CISIAAdapter",
  async discover() {
    return [
      {
        title: "TOLC-E",
        universityName: "CISIA",
        degreeLevel: "OTHER",
        field: "TOLC",
        officialUrl: "https://www.cisiaonline.it/",
      },
      {
        title: "TOLC-I",
        universityName: "CISIA",
        degreeLevel: "OTHER",
        field: "TOLC",
        officialUrl: "https://www.cisiaonline.it/",
      },
    ];
  },
};

export const maeciAdapter: ProgramSourceAdapter = {
  name: "MAECIAdapter",
  async discover() {
    return [
      {
        title: "Study in Italy / MAECI scholarships (context)",
        universityName: "MAECI",
        degreeLevel: "OTHER",
        officialUrl: "https://studyinitaly.esteri.it/",
      },
    ];
  },
};
