import { describe, expect, it } from "vitest";
import { normalizeJobAnalysis, normalizeResumeStructuredData } from "./validation";
import type { Job, Resume } from "../../types/models";

const job = {
  id: "job-1",
  title: "Project Manager",
  company: "Acme",
  requirements: ["Jira"],
  preferredQualifications: [],
  responsibilities: ["Coordinate delivery"],
  skills: ["Jira"],
} as unknown as Job;

const resume = { id: "resume-1", name: "Base" } as Resume;

describe("LLM response validation", () => {
  it("normalizes missing resume arrays and preserves contact data", () => {
    const data = normalizeResumeStructuredData({ fullName: "Jane Doe", skills: "Jira" });
    expect(data.fullName).toBe("Jane Doe");
    expect(data.skills).toEqual(["Jira"]);
    expect(data.workExperience).toEqual([]);
    expect(data.education).toEqual([]);
  });

  it("filters unknown resume ids and creates safe fallback matches", () => {
    const result = normalizeJobAnalysis(
      { analysis: { summary: "Good fit" }, matches: [{ resumeId: "unknown", score: 900 }] },
      job,
      [resume],
    );
    expect(result.analysis.summary).toBe("Good fit");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].resumeId).toBe("resume-1");
    expect(result.matches[0].score).toBe(0);
  });
});
