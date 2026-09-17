export type JobStatus = 'Saved' | 'Analyzing' | 'Applied' | 'Interview' | 'Rejected' | 'Offer' | 'Withdrawn' | 'Archived';
export type RemoteType = 'remote' | 'hybrid' | 'on-site' | 'unknown';
export type FieldCategory = 'fixed' | 'reusable' | 'llm' | 'ignore';
export interface StatusChange { timestamp: string; previousStatus: JobStatus; newStatus: JobStatus; }

export interface ResumeStructuredData {
  firstName?: string; lastName?: string; fullName?: string; email?: string; phone?: string;
  address?: string; city?: string; province?: string; postalCode?: string; linkedin?: string;
  portfolio?: string; website?: string; workAuthorization?: string; jobTitles: string[];
  skills: string[]; companies: string[]; workExperience: Array<{ title: string; company: string; dates?: string; bullets: string[] }>;
  achievements: string[]; projects: string[]; education: string[]; certifications: string[];
  languages: string[]; tools: string[]; industries: string[];
}

export interface Resume {
  id: string; name: string; fileName: string; mimeType: string; file: Blob; parsedText: string;
  structuredData: ResumeStructuredData; targetRoles: string[]; preferred: boolean; parentId?: string;
  version: number; createdAt: string; updatedAt: string;
}

export interface JobAnalysis { summary: string; seniority: string; mandatoryRequirements: string[]; preferredRequirements: string[]; skills: string[]; keywords: string[]; responsibilities: string[]; redFlags: string[]; }
export interface ResumeMatch { resumeId: string; score: number; strengths: string[]; missingRequirements: string[]; matchingSkills: string[]; relevantExperience: string[]; concerns: string[]; recommendation: string; }

export interface Job {
  id: string; title: string; company: string; location: string; remoteType: RemoteType; employmentType?: string;
  salary?: string; description: string; responsibilities: string[]; requirements: string[]; preferredQualifications: string[];
  skills: string[]; benefits: string[]; source: string; sourceUrl: string; applicationUrl?: string; externalId?: string;
  postedAt?: string; discoveredAt: string; lastSeenAt: string; status: JobStatus; resumeId?: string; resumeVersionId?: string;
  matchScore?: number; analysis?: JobAnalysis; matches?: ResumeMatch[]; notes: string; statusHistory: StatusChange[]; lastActivityAt: string;
}

export interface JobSession { id: string; tabId?: number; jobId?: string; url: string; startedAt: string; updatedAt: string; pageContext: PageContext; events: SessionEvent[]; generatedAnswers: GeneratedAnswer[]; status: 'active' | 'closed'; }
export interface PageContext { title: string; url: string; htmlSnapshot?: string; extractedText: string; metadata: Partial<Job>; capturedAt: string; }
export interface SessionEvent { id: string; type: string; timestamp: string; detail?: string; }
export interface GeneratedAnswer { fieldId: string; question: string; answer: string; createdAt: string; edited?: boolean; }

export interface FormField { id: string; selector: string; label: string; name: string; type: string; value: string; required: boolean; category: FieldCategory; status: 'detected' | 'filled' | 'review'; confidence: number; source?: string; instructions?: string; prompt?: string; }
export interface KnowledgeItem { id: string; type: 'personal' | 'professional' | 'experience' | 'achievement' | 'preference' | 'application_answer' | 'cover_letter_fragment' | 'custom'; question?: string; answer: string; tags: string[]; source: string; confidence: number; createdAt: string; updatedAt: string; }
export interface UserProfile { id: 'default'; firstName: string; lastName: string; fullName: string; email: string; phone: string; address: string; city: string; province: string; postalCode: string; linkedin: string; portfolio: string; website: string; workAuthorization: string; education: string[]; experience: string[]; skills: string[]; certifications: string[]; links: string[]; preferences: string[]; }
export interface Settings { id: 'default'; llmProvider: 'openrouter'; openRouterApiKey: string; openRouterModel: string; temperature: number; maxTokens: number; parserEnabled: boolean; apifyApiKey: string; apifyActor: string; parserSchedule: string; jobTitles: string[]; keywords: string[]; locations: string[]; remoteTypes: string[]; platforms: string[]; excludeKeywords: string[]; minimumSalary?: number; debugLogging: boolean; backendUrl: string; backendToken: string; syncEnabled: boolean; }

export interface ApplicationRecord { id: string; jobId: string; sessionId: string; resumeId?: string; resumeVersionId?: string; submittedAt: string; answers: GeneratedAnswer[]; metadata: Record<string, unknown>; }
