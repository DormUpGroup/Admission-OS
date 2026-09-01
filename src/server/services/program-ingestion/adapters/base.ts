export type DiscoverResult = {
  externalId?: string;
  title: string;
  universityName: string;
  city?: string;
  region?: string;
  degreeLevel: string;
  language?: string;
  field?: string;
  officialUrl?: string;
  universitalyUrl?: string;
  academicYear?: string;
};

export interface ProgramSourceAdapter {
  name: string;
  discover(academicYear: string): Promise<DiscoverResult[]>;
  fetch?(url: string): Promise<{ url: string; body: string; contentType: string }>;
  parse?(body: string, meta: { url: string }): Promise<Record<string, unknown>>;
  normalize?(raw: Record<string, unknown>): Promise<Record<string, unknown>>;
  validate?(normalized: Record<string, unknown>): Promise<{ ok: boolean; errors: string[] }>;
}
