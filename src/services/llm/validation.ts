import type {
  Job,
  JobAnalysis,
  Resume,
  ResumeMatch,
  ResumeStructuredData,
} from "../../types/models";

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : stringValue(value)
      ? [stringValue(value)]
      : [];

const unique = (values: string[]) => [...new Set(values)];

export function normalizeResumeStructuredData(value: unknown): ResumeStructuredData {
  const source = objectValue(value);
  const workExperience = Array.isArray(source.workExperience)
    ? source.workExperience.map((item) => {
        const experience = objectValue(item);
        return {
          title: stringValue(experience.title),
          company: stringValue(experience.company),
          dates: stringValue(experience.dates) || undefined,
          bullets: stringArray(experience.bullets),
        };
      })
    : [];
  return {
    firstName: stringValue(source.firstName) || undefined,
    lastName: stringValue(source.lastName) || undefined,
    fullName: stringValue(source.fullName) || undefined,
    email: stringValue(source.email) || undefined,
    phone: stringValue(source.phone) || undefined,
    address: stringValue(source.address) || undefined,
    city: stringValue(source.city) || undefined,
    province: stringValue(source.province) || undefined,
    postalCode: stringValue(source.postalCode) || undefined,
    linkedin: stringValue(source.linkedin) || undefined,
    portfolio: stringValue(source.portfolio) || undefined,
    website: stringValue(source.website) || undefined,
    workAuthorization: stringValue(source.workAuthorization) || undefined,
    jobTitles: unique(stringArray(source.jobTitles)),
    skills: unique(stringArray(source.skills)),
    companies: unique(stringArray(source.companies)),
    workExperience,
    achievements: unique(stringArray(source.achievements)),
    projects: unique(stringArray(source.projects)),
    education: unique(stringArray(source.education)),
    certifications: unique(stringArray(source.certifications)),
    languages: unique(stringArray(source.languages)),
    tools: unique(stringArray(source.tools)),
    industries: unique(stringArray(source.industries)),
  };
}

const boundedScore = (value: unknown) => {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
};

export function normalizeJobAnalysis(
  value: unknown,
  job: Job,
  resumes: Resume[],
): { analysis: JobAnalysis; matches: ResumeMatch[] } {
  const root = objectValue(value);
  const source = objectValue(root.analysis);
  const analysis: JobAnalysis = {
    summary: stringValue(source.summary) || `${job.title} at ${job.company}`,
    seniority: stringValue(source.seniority) || "Unknown",
    mandatoryRequirements: stringArray(source.mandatoryRequirements).length
      ? stringArray(source.mandatoryRequirements)
      : job.requirements,
    preferredRequirements: stringArray(source.preferredRequirements).length
      ? stringArray(source.preferredRequirements)
      : job.preferredQualifications,
    skills: stringArray(source.skills).length ? stringArray(source.skills) : job.skills,
    keywords: stringArray(source.keywords),
    responsibilities: stringArray(source.responsibilities).length
      ? stringArray(source.responsibilities)
      : job.responsibilities,
    redFlags: stringArray(source.redFlags),
  };

  const knownResumeIds = new Set(resumes.map((resume) => resume.id));
  const rawMatches = Array.isArray(root.matches) ? root.matches : [];
  const normalized = rawMatches
    .map((item) => {
      const match = objectValue(item);
      const resumeId = stringValue(match.resumeId);
      if (!knownResumeIds.has(resumeId)) return undefined;
      return {
        resumeId,
        score: boundedScore(match.score),
        strengths: stringArray(match.strengths),
        missingRequirements: stringArray(match.missingRequirements),
        matchingSkills: stringArray(match.matchingSkills),
        relevantExperience: stringArray(match.relevantExperience),
        concerns: stringArray(match.concerns),
        recommendation: stringValue(match.recommendation) || "Review before applying",
      } satisfies ResumeMatch;
    })
    .filter((match): match is ResumeMatch => Boolean(match));

  const byResume = new Map(normalized.map((match) => [match.resumeId, match]));
  for (const resume of resumes) {
    if (!byResume.has(resume.id)) {
      byResume.set(resume.id, {
        resumeId: resume.id,
        score: 0,
        strengths: [],
        missingRequirements: [],
        matchingSkills: [],
        relevantExperience: [],
        concerns: ["No valid match result was returned by the model."],
        recommendation: "Review manually",
      });
    }
  }
  return {
    analysis,
    matches: [...byResume.values()].sort((a, b) => b.score - a.score),
  };
}
