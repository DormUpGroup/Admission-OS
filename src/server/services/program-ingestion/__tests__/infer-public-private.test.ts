import { describe, expect, it } from "vitest";
import {
  inferPublicPrivateFromDocumentText,
  inferPublicPrivateFromUniversityName,
} from "@/server/services/program-ingestion/infer-public-private";

describe("inferPublicPrivateFromUniversityName", () => {
  it("marks MUR non-state universities as PRIVATE", () => {
    const privateNames = [
      "Luiss Libera Università Internazionale degli Studi Sociali Guido Carli",
      "Università Commerciale \"Luigi Bocconi\" MILANO",
      "Università Cattolica del Sacro Cuore",
      "Libera Università di BOLZANO",
      "Free University of Bozen-Bolzano",
      "LUMSA_Libera Università Maria Santissima Assunta",
      "IULM_Libera università di lingue e comunicazione",
      "Humanitas University",
      "Università Vita-Salute San Raffaele",
      "Università Campus Bio-medico",
      "Link Campus University",
      "Università degli Studi di Enna \"Kore\"",
      "Università degli Studi Internazionali di Roma",
      "Università degli Studi Europea di Roma",
      "LIUC Università Cattaneo",
      "Università degli Studi Suor Orsola Benincasa",
      "Saint Camillus International University of Health and Medical Sciences",
      "Università degli Studi di Scienze Gastronomiche",
      "LUM Libera Università Mediterranea Giuseppe Degennaro",
      "Università per Stranieri Dante Alighieri",
      "Università della Valle d'Aosta",
      "UNINEUROMED - Neuromed Mediterranean University",
    ];
    for (const name of privateNames) {
      expect(inferPublicPrivateFromUniversityName(name), name).toBe("PRIVATE");
    }
  });

  it("marks MUR telematic universities as PRIVATE", () => {
    const telematic = [
      "Università Telematica Pegaso",
      "Università telematica e-Campus",
      "Università Telematica Internazionale Uninettuno",
      "Università Telematica Unitelma Sapienza",
      "Università degli Studi Guglielmo Marconi",
      "Università Telematica Niccolò Cusano",
      "Università Telematica Giustino Fortunato",
      "Università telematica IUL",
      "Universitas Mercatorum",
      "Università Telematica Leonardo da Vinci",
      "Università Telematica San Raffaele",
    ];
    for (const name of telematic) {
      expect(inferPublicPrivateFromUniversityName(name), name).toBe("PRIVATE");
    }
  });

  it("marks state universities as PUBLIC", () => {
    const publicNames = [
      "Alma Mater Studiorum - Università di BOLOGNA",
      "Università degli Studi di PADOVA",
      "Sapienza Università di Roma",
      "Sapienza University of Rome",
      "Politecnico di Milano",
      "Politecnico di TORINO",
      "Università degli Studi di Milano",
      "Università Mediterranea di Reggio Calabria",
      "Università degli Studi di Napoli Federico II",
      "Ca' Foscari University of Venice",
    ];
    for (const name of publicNames) {
      expect(inferPublicPrivateFromUniversityName(name), name).toBe("PUBLIC");
    }
  });

  it("does not treat Unitelma's Sapienza suffix as a state university", () => {
    expect(
      inferPublicPrivateFromUniversityName(
        "Università Telematica UNITELMA Sapienza"
      )
    ).toBe("PRIVATE");
  });

  it("returns UNKNOWN when the name is not a university", () => {
    expect(inferPublicPrivateFromUniversityName("")).toBe("UNKNOWN");
    expect(inferPublicPrivateFromUniversityName("Conservatorio di Musica")).toBe(
      "UNKNOWN"
    );
  });
});

describe("inferPublicPrivateFromDocumentText", () => {
  it("detects libera / privata phrases without scanning other university names", () => {
    expect(
      inferPublicPrivateFromDocumentText(
        "Bando di ammissione. Libera Università Internazionale degli Studi Sociali."
      )
    ).toBe("PRIVATE");
    expect(
      inferPublicPrivateFromDocumentText(
        "Università statale. Accesso libero. 40 posti extra-UE."
      )
    ).toBe("PUBLIC");
    expect(
      inferPublicPrivateFromDocumentText(
        "Tuition from €156. Deadline 15 May. Partner mention only."
      )
    ).toBe("UNKNOWN");
  });
});
