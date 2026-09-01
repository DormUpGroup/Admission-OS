declare module "pdf-parse" {
  type PdfData = { text: string; numpages?: number; info?: unknown };
  function pdfParse(data: Buffer): Promise<PdfData>;
  export default pdfParse;
}
