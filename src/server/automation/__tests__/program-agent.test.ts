import { describe, expect, it } from "vitest";
import {
  PROGRAM_MCP_TOOLS,
  programRunInstructions,
  toolsForProfile,
} from "@/server/automation/capability-grant";
import { isHermesProfileKey } from "@/server/automation/hermes-client";
import { AGENT_DEFINITIONS_BY_KEY } from "@/server/automation/registry";
import { ALWAYS_ALLOWED_EVENT_TYPES } from "@/server/commands/outbox";
import { PROGRAMS_MATCH_EVENT } from "@/server/services/program-matching/match-job";

describe("program Hermes agent adapter", () => {
  it("registers the program agent with match_job tools", () => {
    const spec = AGENT_DEFINITIONS_BY_KEY.get("program");
    expect(spec).toBeTruthy();
    expect(spec?.eventTypes).toContain("programs.match.requested");
    expect(spec?.allowedTools).toEqual([...PROGRAM_MCP_TOOLS]);
  });

  it("exposes program tools on the program MCP profile", () => {
    expect(toolsForProfile("program")).toEqual([...PROGRAM_MCP_TOOLS]);
    expect(isHermesProfileKey("program")).toBe(true);
  });

  it("keeps programs.match always allowed for the worker", () => {
    expect(ALWAYS_ALLOWED_EVENT_TYPES.has(PROGRAMS_MATCH_EVENT)).toBe(true);
  });

  it("instructs Hermes to start the job and not wait", () => {
    const text = programRunInstructions("grant-1", "student-1");
    expect(text).toContain("grant_id=grant-1");
    expect(text).toContain("student_id: student-1");
    expect(text).toContain("program.match_job.start");
    expect(text).toContain("Do not wait for the job to finish");
  });
});
