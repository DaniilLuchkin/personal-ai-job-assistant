import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Download,
  ExternalLink,
  Paperclip,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import type { ExtensionMessage, ExtensionResponse } from "../types/messages";
import type {
  ApplicationRecord,
  FieldRule,
  FormField,
  Job,
  JobSession,
  KnowledgeItem,
  Resume,
  Settings,
  UserProfile,
} from "../types/models";
import { repos } from "../repositories/repositories";
import { defaultProfile, defaultSettings } from "../services/profile/defaults";
import {
  extractResumeText,
  heuristicResumeData,
} from "../services/resume/parser";
import { getLLMProvider } from "../services/llm/providerFactory";
import { HeuristicProvider } from "../services/llm/HeuristicProvider";
import {
  normalizeExternalJob,
  normalizePageContext,
} from "../services/parser/normalization";
import { findDuplicateJob } from "../services/parser/deduplication";
import { ApifyProvider } from "../services/parser/ApifyProvider";
import { buildFieldContext } from "../services/context/buildFieldContext";
import { applyFieldRules, createDefaultFieldRules } from "../services/form/fieldRules";
import { createResumeDocx } from "../services/resume/document";
import {
  fetchOpenRouterModels,
  type OpenRouterModel,
} from "../services/llm/models";
import { now, uid } from "../utils/id";
import { configureDebugLogging, debugLog } from "../utils/logger";
import { syncRecord } from "../services/api/backendClient";
import {
  deleteRemoteRecord,
  clearBackendData,
  downloadResumeFile,
  loginBackend,
  pullRecords,
  runBackendParser,
  saveBackendParserConfig,
  uploadResumeFile,
} from "../services/api/backendClient";
import "./styles.css";

type View = "dashboard" | "resumes" | "session" | "settings" | "knowledge";
type AdaptationDraft = { jobId: string; baseResumeId: string; adaptedText: string; changeSummary: string[]; targetTitle: string };
type ExportBundle = { version: 1; exportedAt: string; jobs: Job[]; resumes: Array<Omit<Resume, 'file'> & { fileData?: string }>; sessions: JobSession[]; applications: ApplicationRecord[]; knowledge: KnowledgeItem[]; fieldRules: FieldRule[]; profile: UserProfile; settings: Settings };
const statusColors: Record<string, string> = {
  Saved: "blue",
  Analyzing: "purple",
  Applied: "green",
  Interview: "orange",
  Rejected: "red",
  Offer: "green",
  Withdrawn: "gray",
  Archived: "gray",
};
const validParserSchedule = (value: string) => /^\*\/([1-9]\d*)\s+\*\s+\*\s+\*\s+\*$/.test(value.trim()) || /^(?:[0-5]?\d)\s+(?:[01]?\d|2[0-3])\s+\*\s+\*\s+\*$/.test(value.trim());
const profileValue = (label: string, profile: UserProfile) => {
  const l = label.toLowerCase();
  if (/first.?name/.test(l)) return profile.firstName;
  if (/last.?name/.test(l)) return profile.lastName;
  if (/full.?name|^name$/.test(l)) return profile.fullName;
  if (/e-?mail/.test(l)) return profile.email;
  if (/phone|mobile/.test(l)) return profile.phone;
  if (/address/.test(l)) return profile.address;
  if (/city/.test(l)) return profile.city;
  if (/province|state/.test(l)) return profile.province;
  if (/postal|zip/.test(l)) return profile.postalCode;
  if (/linkedin/.test(l)) return profile.linkedin;
  if (/portfolio/.test(l)) return profile.portfolio;
  if (/website/.test(l)) return profile.website;
  if (/authorization|sponsor/.test(l)) return profile.workAuthorization;
  return "";
};
const cvValue = (label: string, profile: UserProfile, resume?: Resume) => {
  const direct = profileValue(label, profile);
  if (direct) return direct;
  const l = label.toLowerCase();
  const data = resume?.structuredData;
  if (/skill|technology|software|tool/.test(l))
    return [
      ...new Set([
        ...(profile.skills || []),
        ...(data?.skills || []),
        ...(data?.tools || []),
      ]),
    ].join(", ");
  if (/education|degree|school|university/.test(l))
    return [
      ...new Set([...(profile.education || []), ...(data?.education || [])]),
    ].join("; ");
  if (/certif/.test(l))
    return [
      ...new Set([
        ...(profile.certifications || []),
        ...(data?.certifications || []),
      ]),
    ].join("; ");
  if (/job title|position|role/.test(l))
    return [
      ...new Set([...(data?.jobTitles || []), ...(resume?.targetRoles || [])]),
    ].join(", ");
  if (/experience|work history|employment/.test(l))
    return [
      ...(profile.experience || []),
      ...(data?.workExperience || []).map(
        (item) => `${item.title} at ${item.company}`,
      ),
    ].join("; ");
  if (/language/.test(l)) return (data?.languages || []).join(", ");
  return "";
};
const activeTab = async () =>
  (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
async function pageMessage(
  message: ExtensionMessage,
): Promise<ExtensionResponse> {
  const tab = await activeTab();
  if (!tab.id) throw new Error("No active tab.");
  return (await chrome.runtime.sendMessage({
    ...message,
    tabId: tab.id,
  })) as ExtensionResponse;
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
  reader.readAsDataURL(blob);
});

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const dataUrlToBlob = (dataUrl: string) => {
  const [header, encoded = ''] = dataUrl.split(',', 2);
  const mimeType = header.match(/^data:([^;]+)/)?.[1] || 'application/octet-stream';
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
};

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [fieldRules, setFieldRules] = useState<FieldRule[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [session, setSession] = useState<JobSession | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [fields, setFields] = useState<FormField[]>([]);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [adaptationDraft, setAdaptationDraft] = useState<AdaptationDraft | null>(null);
  const refresh = async () => {
    const savedSettings = await repos.settings.get();
    const mergedSettings = savedSettings
      ? { ...defaultSettings, ...savedSettings }
      : defaultSettings;
    if (
      mergedSettings.syncEnabled &&
      mergedSettings.backendUrl &&
      mergedSettings.backendToken
    ) {
      try {
        const remote = await pullRecords(mergedSettings);
        for (const record of remote) {
          if (record.entity_type === "job")
            await repos.jobs.put(record.payload as unknown as Job);
          else if (record.entity_type === "resume") {
            const existing = await repos.resumes.get(record.entity_id);
            let file = existing?.file ?? new Blob();
            if (!existing?.file) {
              try {
                file = await downloadResumeFile(
                  mergedSettings,
                  record.entity_id,
                );
              } catch {
                /* metadata remains usable if the original file is unavailable */
              }
            }
            await repos.resumes.put({
              ...(record.payload as unknown as Resume),
              file,
              id: record.entity_id,
            });
          } else if (record.entity_type === "session")
            await repos.sessions.put(record.payload as unknown as JobSession);
          else if (record.entity_type === "knowledge")
            await repos.knowledge.put(
              record.payload as unknown as KnowledgeItem,
            );
          else if (record.entity_type === "field_rule")
            await repos.fieldRules.put(record.payload as unknown as FieldRule);
          else if (record.entity_type === "profile")
            await repos.profile.put({ ...defaultProfile, ...(record.payload as unknown as Partial<UserProfile>), id: 'default' });
          else if (record.entity_type === "application")
            await repos.applications.put(record.payload as never);
        }
      } catch {
        setToast("Server unavailable; showing local cache");
      }
    }
    const [j, r, p, s, k, sessions, storedRules, storedApplications] = await Promise.all([
      repos.jobs.list(),
      repos.resumes.list(),
      repos.profile.get(),
      repos.settings.get(),
      repos.knowledge.list(),
      repos.sessions.list(),
      repos.fieldRules.list(),
      repos.applications.list(),
    ]);
    const defaultRules = createDefaultFieldRules();
    const storedRuleIds = new Set(storedRules.map((rule) => rule.id));
    const missingDefaults = defaultRules.filter((rule) => !storedRuleIds.has(rule.id));
    const rules = [...storedRules, ...missingDefaults];
    if (missingDefaults.length) await Promise.all(missingDefaults.map((rule) => repos.fieldRules.put(rule)));
    setJobs(j.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)));
    setResumes(r);
    setProfile(p ?? defaultProfile);
    setSettings(s ? { ...defaultSettings, ...s } : defaultSettings);
    configureDebugLogging(Boolean(s?.debugLogging));
    setKnowledge(k);
    setFieldRules(rules.sort((a, b) => a.name.localeCompare(b.name)));
    setApplications(storedApplications.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)));
    if (session) {
      const persisted = sessions.find((item) => item.id === session.id);
      if (!persisted || persisted.status === 'closed') {
        setSession(null);
        setFields([]);
      } else {
        setSession(persisted);
        setSelectedJobId(persisted.jobId);
        setFields(persisted.formFields ?? []);
      }
    } else {
      const activeSession = sessions
        .filter((item) => item.status === "active")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      setSession(activeSession ?? null);
      setSelectedJobId(activeSession?.jobId);
      setFields(activeSession?.formFields ?? []);
    }
  };
  const sync = (type: string, id: string, payload: unknown) => {
    syncRecord(settings, type, id, payload).catch(() =>
      setToast("Saved locally; server sync will retry when configured"),
    );
  };
  useEffect(() => {
    refresh().catch((e) =>
      setToast(e instanceof Error ? e.message : "Unable to load local data"),
    );
  }, []);
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const snapshot: JobSession = {
      ...session,
      formFields: fields,
      updatedAt: now(),
    };
    const timer = setTimeout(() => {
      repos.sessions.put(snapshot).catch(() => undefined);
      const lightweight = {
        ...snapshot,
        pageContext: { ...snapshot.pageContext, htmlSnapshot: undefined },
        applicationPageContext: snapshot.applicationPageContext ? { ...snapshot.applicationPageContext, htmlSnapshot: undefined } : undefined,
        screenshots: snapshot.screenshots?.map(({ id, capturedAt, pageUrl }) => ({ id, capturedAt, pageUrl, dataUrl: '' })),
      };
      syncRecord(settings, "session", snapshot.id, lightweight).catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [session, fields]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const notifyError = (error: unknown) =>
    setToast(error instanceof Error ? error.message : "Something went wrong");
  const analyze = async () => {
    debugLog('Session', 'Analysis started');
    setBusy("analyze");
    setFields([]);
    try {
      let responseContext: JobSession['pageContext'];
      const tab = await activeTab();
      try {
        const response = await pageMessage({ type: "CAPTURE_PAGE_CONTEXT" });
        if (!response.ok || !("context" in response)) throw new Error(!response.ok ? response.error : "Page context unavailable");
        responseContext = response.context;
      } catch (captureError) {
        if (!tab.url || !/\.pdf(?:$|[?#])/i.test(tab.url)) throw captureError;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const pdfResponse = await fetch(tab.url, { signal: controller.signal });
          if (!pdfResponse.ok) throw new Error(`PDF download failed (${pdfResponse.status})`);
          const blob = await pdfResponse.blob();
          if (blob.size > 10 * 1024 * 1024) throw new Error('PDF is larger than 10 MB.');
          const fileName = decodeURIComponent(tab.url.split('/').pop()?.split(/[?#]/)[0] || 'job.pdf');
          const text = await extractResumeText(new File([blob], fileName, { type: 'application/pdf' }));
          responseContext = { title: tab.title || fileName, url: tab.url, extractedText: text, metadata: { title: tab.title || fileName, sourceUrl: tab.url, applicationUrl: tab.url, description: text }, capturedAt: now() };
        } finally {
          clearTimeout(timer);
        }
      }
      const normalized = normalizePageContext(responseContext);
      const existing = findDuplicateJob(normalized, jobs);
      const stamp = now();
      const job = existing
        ? {
            ...existing,
            ...normalized,
            id: existing.id,
            discoveredAt: existing.discoveredAt,
            status: "Analyzing" as const,
            lastSeenAt: stamp,
          }
        : { ...normalized, status: "Analyzing" as const };
      await repos.jobs.put(job);
      const started = stamp;
      if (session?.status === 'active') {
        const superseded: JobSession = { ...session, status: 'closed', updatedAt: started, formFields: fields, events: [...session.events, { id: uid('event'), type: 'superseded_by_new_session', timestamp: started }] };
        await repos.sessions.put(superseded);
        sync('session', superseded.id, superseded);
      }
      let screenshots: JobSession["screenshots"] = [];
      try {
        const screenshotResponse = await pageMessage({ type: "CAPTURE_SCREENSHOT" });
        if (screenshotResponse.ok && "screenshot" in screenshotResponse) {
          screenshots = [{ id: uid("screenshot"), dataUrl: screenshotResponse.screenshot, capturedAt: started, pageUrl: responseContext.url }];
        }
      } catch {
        // Screenshot is optional; text and structured context are already saved.
      }
      const nextSession: JobSession = {
        id: uid("session"),
        tabId: tab.id,
        jobId: job.id,
        url: job.sourceUrl,
        startedAt: started,
        updatedAt: started,
        pageContext: responseContext,
        screenshots,
        pdfDocuments: (responseContext.pdfLinks || []).map((url) => ({
          url,
          name: decodeURIComponent(url.split('/').pop()?.split(/[?#]/)[0] || 'document.pdf'),
          capturedAt: started,
        })),
        events: [
          { id: uid("event"), type: "context_captured", timestamp: started },
          ...(screenshots.length ? [{ id: uid("event"), type: "screenshot_captured", timestamp: started }] : []),
        ],
        generatedAnswers: [],
        status: "active",
      };
      await repos.sessions.put(nextSession);
      sync('session', nextSession.id, nextSession);
      setSession(nextSession);
      setSelectedJobId(job.id);
      const provider = getLLMProvider(settings);
      let analysisProvider = provider;
      let result;
      try {
        const sparsePage = responseContext.extractedText.length < 1200;
        try {
          result = await provider.analyzeJob(job, resumes, profile, { screenshots: sparsePage ? screenshots.map((item) => item.dataUrl) : undefined });
        } catch (imageError) {
          if (!sparsePage || !screenshots.length) throw imageError;
          result = await provider.analyzeJob(job, resumes, profile);
        }
      } catch (providerError) {
        if (provider.name === "Local fallback") throw providerError;
        analysisProvider = new HeuristicProvider();
        result = await analysisProvider.analyzeJob(job, resumes, profile);
      }
      const best = result.matches[0];
      const updated = {
        ...job,
        status: "Saved" as const,
        analysis: result.analysis,
        matches: result.matches,
        matchScore: best?.score,
        resumeId: best?.resumeId,
        resumeVersionId: best?.resumeId,
        lastActivityAt: now(),
      };
      await repos.jobs.put(updated);
      setJobs((items) => [
        updated,
        ...items.filter((item) => item.id !== job.id),
      ]);
      setSession({ ...nextSession, updatedAt: now() });
      setView("session");
      setToast(
        `${existing ? "Updated existing job" : "New job"} analyzed with ${analysisProvider.name}`,
      );
      debugLog('LLM', 'Job analysis completed', { resumes: resumes.length, matches: result.matches.length });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy("");
    }
  };
  const uploadResume = async (file: File) => {
    setBusy("upload");
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension !== "pdf" && extension !== "docx")
        throw new Error("Please select a PDF or DOCX resume.");
      if (file.size > 10 * 1024 * 1024) throw new Error('Resume files must be 10 MB or smaller.');
      const inferredType = extension === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const storedFile = file.type ? file : new File([file], file.name, { type: inferredType });

      let text = "";
      let parseWarning = "";
      try {
        text = await extractResumeText(storedFile);
        if (!text.trim())
          parseWarning =
            "Text was not found; the original file was saved for review.";
      } catch {
        parseWarning =
          "Text extraction failed; the original file was saved. Try a text-based PDF or DOCX.";
      }

      const provider = getLLMProvider(settings);
      let data = heuristicResumeData(text);
      if (text.trim()) {
        try {
          data = await provider.extractResumeData(text);
        } catch {
          data = heuristicResumeData(text);
        }
      }
      const stamp = now();
      const resume: Resume = {
        id: uid("resume"),
        name: file.name.replace(/\.(pdf|docx)$/i, ""),
        fileName: file.name,
        mimeType: storedFile.type,
        file: storedFile,
        parsedText: text,
        structuredData: data,
        targetRoles: data.jobTitles,
        preferred: resumes.length === 0,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await repos.resumes.put(resume);
      sync("resume", resume.id, { ...resume, file: undefined });
      uploadResumeFile(settings, resume.id, storedFile, file.name).catch(() =>
        setToast("Resume saved locally; server file upload will retry later"),
      );
      const extractedExperience = (data.workExperience || []).map(
        (item) =>
          `${item.title}${item.company ? ` at ${item.company}` : ""}${item.dates ? ` (${item.dates})` : ""}${item.bullets?.length ? `: ${item.bullets.join("; ")}` : ""}`,
      );
      const nameParts = (data.fullName || "").trim().split(/\s+/).filter(Boolean);
      const merged = {
        ...profile,
        firstName:
          profile.firstName ||
          data.firstName ||
          nameParts[0] ||
          "",
        lastName:
          profile.lastName ||
          data.lastName ||
          (nameParts.length > 1 ? nameParts.slice(1).join(" ") : ""),
        fullName: profile.fullName || data.fullName || "",
        email: profile.email || data.email || "",
        phone: profile.phone || data.phone || "",
        address: profile.address || data.address || "",
        city: profile.city || data.city || "",
        province: profile.province || data.province || "",
        postalCode: profile.postalCode || data.postalCode || "",
        linkedin: profile.linkedin || data.linkedin || "",
        portfolio: profile.portfolio || data.portfolio || "",
        website: profile.website || data.website || "",
        workAuthorization:
          profile.workAuthorization || data.workAuthorization || "",
        education: [
          ...new Set([...profile.education, ...(data.education || [])]),
        ],
        experience: [
          ...new Set([...profile.experience, ...extractedExperience]),
        ],
        certifications: [
          ...new Set([
            ...profile.certifications,
            ...(data.certifications || []),
          ]),
        ],
        skills: [
          ...new Set([
            ...profile.skills,
            ...(data.skills || []),
            ...(data.tools || []),
          ]),
        ],
      };
      await repos.profile.put(merged);
      sync("profile", "default", merged);
      setProfile(merged);
      setResumes((items) => [...items, resume]);
      setToast(parseWarning || `Imported ${file.name} with ${provider.name}`);
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy("");
    }
  };
  const detectForm = async () => {
    setBusy("detect");
    try {
      let applicationContext: JobSession["applicationPageContext"];
      try {
        const contextResponse = await pageMessage({ type: "CAPTURE_PAGE_CONTEXT" });
        if (contextResponse.ok && "context" in contextResponse) applicationContext = contextResponse.context;
      } catch {
        // Field detection can still work when optional page context capture fails.
      }
      const response = await pageMessage({ type: "DETECT_FORM_FIELDS" });
      if (!response.ok || !("fields" in response))
        throw new Error(
          !response.ok ? response.error : "Form fields unavailable",
        );
      const activeJob = jobs.find((item) => item.id === session?.jobId);
      const activeResume = activeJob?.resumeId ? resumes.find((item) => item.id === activeJob.resumeId) : undefined;
      const previous = new Map(fields.map((field) => [field.selector, field]));
      const detected = applyFieldRules(response.fields, fieldRules).map((field) => {
        const prior = previous.get(field.selector);
        if (prior) return { ...field, category: prior.category, value: prior.value, checked: prior.checked, prompt: prior.prompt, instructions: prior.instructions, source: prior.source, ruleId: prior.ruleId || field.ruleId };
        if (field.type === 'file') return { ...field, value: activeResume?.fileName || '', source: activeResume ? 'Selected resume' : undefined };
        const suggestion = field.category === 'fixed' ? profileValue(field.label, profile) : field.category === 'reusable' ? cvValue(field.label, profile, activeResume) : '';
        return suggestion && !field.value ? { ...field, value: suggestion, source: field.category === 'fixed' ? 'User Profile' : 'CV / User Profile' } : field;
      });
      setFields(detected);
      if (session) {
        const tab = await activeTab();
        const updatedSession: JobSession = {
          ...session,
          tabId: tab.id,
          applicationPageContext: applicationContext || session.applicationPageContext,
          formFields: detected,
          events: [...session.events, { id: uid('event'), type: 'form_detected', timestamp: now(), detail: `${detected.length} fields` }],
          updatedAt: now(),
        };
        await repos.sessions.put(updatedSession);
        sync('session', updatedSession.id, updatedSession);
        setSession(updatedSession);
      }
      setView("session");
      setToast(`${detected.length} application fields detected`);
      debugLog('Form Detection', 'Fields detected', { fields: detected.length, lowConfidence: detected.filter((field) => field.confidence < 0.8).length });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy("");
    }
  };
  const fillForm = async () => {
    setBusy("fill");
    try {
      const activeJob = jobs.find((item) => item.id === session?.jobId);
      const activeResume = activeJob?.resumeId
        ? resumes.find((item) => item.id === activeJob.resumeId)
        : undefined;
      const values = fields
        .filter((field) => field.category !== "ignore" && field.type !== 'file')
        .map((field) => ({
          selector: field.selector,
          frameId: field.frameId,
          value:
            field.value ||
            (field.category === "fixed"
              ? profileValue(field.label, profile)
              : cvValue(field.label, profile, activeResume)),
          checked: field.checked,
        }))
        .filter((field) => field.value);
      const response = await pageMessage({
        type: "FILL_FORM_FIELDS",
        fields: values,
      });
      if (!response.ok || !("filled" in response))
        throw new Error(!response.ok ? response.error : "Form fill failed");
      let attached = 0;
      const fileFields = fields.filter((field) => field.category !== 'ignore' && field.type === 'file');
      if (fileFields.length) {
        if (!activeResume) throw new Error('Select a resume before attaching it to the application.');
        if (!activeResume.file?.size) throw new Error('The selected resume file is unavailable on this computer. Open Resumes and sync or upload it again.');
        const dataUrl = await blobToDataUrl(activeResume.file);
        for (const field of fileFields) {
          const fileResponse = await pageMessage({ type: 'FILL_FILE_FIELD', selector: field.selector, frameId: field.frameId, fileName: activeResume.fileName, mimeType: activeResume.mimeType, dataUrl });
          if (fileResponse.ok && 'attached' in fileResponse && fileResponse.attached) attached += 1;
        }
      }
      setFields((items) =>
        items.map((field) =>
          field.type === 'file' && fileFields.some((item) => item.id === field.id) && attached
            ? { ...field, value: activeResume?.fileName || field.value, status: 'filled', source: 'Selected resume' }
            : values.some((value) => value.selector === field.selector)
            ? {
                ...field,
                value:
                  values.find((value) => value.selector === field.selector)
                    ?.value || field.value,
                checked: values.find(
                  (value) => value.selector === field.selector,
                )?.checked ?? field.checked,
                status: "filled",
                source: field.source || (field.category === "fixed" ? "User Profile" : field.category === 'llm' ? 'Generated answer' : "Reusable data"),
              }
            : field,
        ),
      );
      setToast(`${response.filled + attached} fields filled or attached — review before submitting`);
      debugLog('Form Detection', 'Form fill completed', { filled: response.filled, attached });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy("");
    }
  };
  const generateField = async (field: FormField) => {
    if (!session?.jobId) return;
    setBusy(`field-${field.id}`);
    try {
      const job = await repos.jobs.get(session.jobId);
      if (!job) throw new Error("Job session is no longer linked to a job.");
      const resume = job.resumeId
        ? await repos.resumes.get(job.resumeId)
        : undefined;
      if (field.category !== "llm") {
        const savedRuleValue = field.ruleId ? fieldRules.find((rule) => rule.id === field.ruleId)?.value : '';
        const suggestion = savedRuleValue || cvValue(field.label, profile, resume);
        if (!suggestion)
          throw new Error(
            `No saved CV value matches “${field.label}”. Add it to User profile or edit the field manually.`,
          );
        setFields((items) =>
          items.map((item) =>
            item.id === field.id
              ? {
                  ...item,
                  value: suggestion,
                  status: "review",
                  source: "CV / User Profile",
                }
              : item,
          ),
        );
        setToast("Suggested from your CV and profile");
        return;
      }
      const context = buildFieldContext(field, job, resume, profile, knowledge, session.applicationPageContext);
      if (!resume || !resume.parsedText.trim()) {
        throw new Error('Select a parsed resume in Resume Pool before generating an application answer.');
      }
      const provider = getLLMProvider(settings);
      const answer = await provider.generateFieldAnswer({
        fieldLabel: context.field.label,
        fieldName: context.field.name,
        fieldType: context.field.type,
        answerKind: context.field.answerKind,
        instructions: context.field.instructions,
        customPrompt: context.field.prompt,
        previousAnswer: field.value || undefined,
        job,
        resume,
        resumeEvidence: context.resume?.evidence,
        profile,
        knowledge: context.knowledge.map((item) => item.answer),
        applicationContext: context.applicationPage?.text,
      });
      if (!answer.trim())
        throw new Error(
          "The selected LLM returned an empty answer. Configure OpenRouter or the Oracle LLM gateway in Settings.",
        );
      setFields((items) =>
        items.map((item) =>
          item.id === field.id
            ? {
                  ...item,
                  value: answer,
                  status: "review",
                  source: `${provider.name} · ${resume.name}`,
              }
            : item,
        ),
      );
      setSession((value) =>
        value
          ? {
              ...value,
              generatedAnswers: [
                ...value.generatedAnswers,
                {
                  fieldId: field.id,
                  question: field.label,
                  answer,
                  createdAt: now(),
                },
              ],
              updatedAt: now(),
            }
          : value,
      );
      setToast(`Generated from ${resume.name} with ${provider.name}`);
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy("");
    }
  };
  const saveApplication = async () => {
    if (!session?.jobId) return;
    setBusy("save");
    try {
      const job = await repos.jobs.get(session.jobId);
      if (!job) throw new Error("Job not found");
      const stamp = now();
      const finalAnswers = fields
        .filter((field) => field.value && (!['checkbox', 'radio'].includes(field.type) || field.checked))
        .map((field) => ({
          fieldId: field.id,
          question: field.label,
          answer: field.value,
          createdAt: stamp,
          edited: field.source?.startsWith("User") || false,
        }));
      const updated = {
        ...job,
        status: "Applied" as const,
        appliedAt: stamp,
        statusHistory: [
          ...(job.statusHistory || []),
          {
            timestamp: stamp,
            previousStatus: job.status,
            newStatus: "Applied" as const,
          },
        ],
        lastActivityAt: stamp,
      };
      await repos.jobs.put(updated);
      sync("job", job.id, updated);
      const closedSession = {
        ...session,
        status: "closed" as const,
        updatedAt: stamp,
        generatedAnswers: finalAnswers,
        formFields: fields,
        events: [
          ...session.events,
          { id: uid("event"), type: "application_submitted", timestamp: stamp },
        ],
      };
      await repos.sessions.put(closedSession);
      sync("session", session.id, closedSession);
      const application = {
        id: uid("application"),
        jobId: job.id,
        sessionId: session.id,
        resumeId: job.resumeId,
        resumeVersionId: job.resumeVersionId,
        submittedAt: stamp,
        answers: finalAnswers,
        metadata: {
          jobUrl: session.url,
          pageUrl: session.applicationPageContext?.url || session.url,
          fieldsReviewed: fields.length,
          fields: fields.map((field) => ({
            id: field.id,
            label: field.label,
            selector: field.selector,
            value: field.value,
            checked: field.checked,
            category: field.category,
            source: field.source,
            confidence: field.confidence,
          })),
        },
      };
      await repos.applications.put(application);
      sync("application", application.id, application);
      setSession(null);
      await refresh();
      setView("dashboard");
      setToast("Application saved and marked Applied");
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy("");
    }
  };
  const updateJobStatus = async (job: Job, status: Job["status"]) => {
    try {
      const updated = {
        ...job,
        status,
        statusHistory: [
          ...(job.statusHistory || []),
          { timestamp: now(), previousStatus: job.status, newStatus: status },
        ],
        lastActivityAt: now(),
      };
      await repos.jobs.put(updated);
      sync("job", job.id, updated);
      setJobs((items) =>
        items.map((item) => (item.id === job.id ? updated : item)),
      );
      setToast(`Status changed to ${status}`);
    } catch (error) {
      notifyError(error);
    }
  };
  const selectResume = async (job: Job, resumeId: string) => {
    try {
      const match = job.matches?.find((item) => item.resumeId === resumeId);
      const updated = {
        ...job,
        resumeId,
        resumeVersionId: resumeId,
        matchScore: match?.score ?? job.matchScore,
        lastActivityAt: now(),
      };
      await repos.jobs.put(updated);
      sync("job", job.id, updated);
      setJobs((items) =>
        items.map((item) => (item.id === job.id ? updated : item)),
      );
      setToast("Resume selected for this application");
    } catch (error) {
      notifyError(error);
    }
  };
  const adaptResume = async (job: Job) => {
    if (!job.resumeId) {
      setToast('Select a resume to adapt first');
      return;
    }
    const baseResume = resumes.find((item) => item.id === job.resumeId);
    if (!baseResume) {
      setToast('The selected resume is unavailable');
      return;
    }
    setBusy('adapt');
    try {
      const provider = getLLMProvider(settings);
      const result = await provider.adaptResume(job, baseResume, profile);
      setAdaptationDraft({ jobId: job.id, baseResumeId: baseResume.id, ...result });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy('');
    }
  };
  const saveAdaptation = async () => {
    if (!adaptationDraft) return;
    setBusy('save-adaptation');
    try {
      const baseResume = resumes.find((item) => item.id === adaptationDraft.baseResumeId);
      const job = jobs.find((item) => item.id === adaptationDraft.jobId);
      if (!baseResume || !job) throw new Error('The source resume or job is no longer available.');
      const rootId = baseResume.parentId || baseResume.id;
      const versions = resumes.filter((item) => item.id === rootId || item.parentId === rootId);
      const version = Math.max(0, ...versions.map((item) => item.version)) + 1;
      const file = await createResumeDocx(adaptationDraft.adaptedText, `${baseResume.name}-${adaptationDraft.targetTitle}-v${version}`);
      const stamp = now();
      const adapted: Resume = {
        ...baseResume,
        id: uid('resume'),
        name: `${baseResume.name} — ${adaptationDraft.targetTitle}`,
        fileName: file.name,
        mimeType: file.type,
        file,
        parsedText: adaptationDraft.adaptedText,
        parentId: rootId,
        version,
        preferred: false,
        targetRoles: [...new Set([adaptationDraft.targetTitle, ...baseResume.targetRoles])],
        adaptationSummary: adaptationDraft.changeSummary,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await repos.resumes.put(adapted);
      sync('resume', adapted.id, { ...adapted, file: undefined });
      uploadResumeFile(settings, adapted.id, file, file.name).catch(() => undefined);
      const baseMatch = job.matches?.find((match) => match.resumeId === baseResume.id);
      const adaptedMatch = baseMatch ? { ...baseMatch, resumeId: adapted.id, recommendation: `${baseMatch.recommendation} · adapted for this role` } : undefined;
      const updatedJob = { ...job, resumeId: adapted.id, resumeVersionId: adapted.id, matches: adaptedMatch ? [...(job.matches || []).filter((match) => match.resumeId !== adapted.id), adaptedMatch] : job.matches, lastActivityAt: stamp };
      await repos.jobs.put(updatedJob);
      sync('job', job.id, updatedJob);
      setResumes((items) => [...items, adapted]);
      setJobs((items) => items.map((item) => item.id === job.id ? updatedJob : item));
      setAdaptationDraft(null);
      setToast(`Adapted resume v${version} saved and selected`);
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy('');
    }
  };
  const rememberField = async (field: FormField, mode: 'answer' | 'preference') => {
    try {
      const stamp = now();
      const existing = field.ruleId ? fieldRules.find((rule) => rule.id === field.ruleId) : undefined;
      const rule: FieldRule = {
        id: existing?.id || uid('field-rule'),
        name: existing?.name || field.label,
        aliases: [...new Set([...(existing?.aliases || []), field.label, field.name].filter(Boolean))],
        category: field.category,
        value: field.category === 'llm' ? existing?.value || '' : field.value,
        status: 'active',
        source: 'User correction',
        editable: true,
        llmEnabled: field.category === 'llm',
        prompt: field.prompt || existing?.prompt,
        instructions: field.instructions || existing?.instructions,
        createdAt: existing?.createdAt || stamp,
        updatedAt: stamp,
      };
      await repos.fieldRules.put(rule);
      sync('field_rule', rule.id, rule);
      setFieldRules((items) => [...items.filter((item) => item.id !== rule.id), rule].sort((a, b) => a.name.localeCompare(b.name)));
      setFields((items) => items.map((item) => item.id === field.id ? { ...item, ruleId: rule.id, source: 'Saved correction' } : item));

      const reusableText = mode === 'preference' ? field.prompt || field.instructions : field.value;
      if (reusableText?.trim()) {
        const activeJob = jobs.find((item) => item.id === session?.jobId);
        const item: KnowledgeItem = {
          id: uid('knowledge'),
          type: mode === 'preference' ? 'preference' : field.category === 'llm' ? 'application_answer' : 'professional',
          question: field.label,
          answer: reusableText.trim(),
          tags: [...new Set([activeJob?.title, field.label].filter((value): value is string => Boolean(value)))],
          source: 'User correction',
          confidence: 1,
          createdAt: stamp,
          updatedAt: stamp,
        };
        await repos.knowledge.put(item);
        sync('knowledge', item.id, item);
        setKnowledge((items) => [item, ...items]);
      }
      setToast(mode === 'preference' ? 'Prompt preference saved' : 'Answer saved for future applications');
    } catch (error) {
      notifyError(error);
    }
  };
  const closeSession = async () => {
    if (!session) return;
    try {
      const stamp = now();
      const closed: JobSession = { ...session, status: 'closed', formFields: fields, updatedAt: stamp, events: [...session.events, { id: uid('event'), type: 'closed_by_user', timestamp: stamp }] };
      await repos.sessions.put(closed);
      sync('session', closed.id, closed);
      setSession(null);
      setFields([]);
      setToast('Session closed and saved');
    } catch (error) {
      notifyError(error);
    }
  };
  const startSessionForJob = async (job: Job) => {
    try {
      const tab = await activeTab();
      const stamp = now();
      if (session?.status === 'active') {
        const closed: JobSession = { ...session, status: 'closed', formFields: fields, updatedAt: stamp, events: [...session.events, { id: uid('event'), type: 'superseded_by_reopened_session', timestamp: stamp }] };
        await repos.sessions.put(closed);
        sync('session', closed.id, closed);
      }
      let applicationPageContext: JobSession['applicationPageContext'];
      try {
        const response = await pageMessage({ type: 'CAPTURE_PAGE_CONTEXT' });
        if (response.ok && 'context' in response && response.context.url !== job.sourceUrl) applicationPageContext = response.context;
      } catch {
        // The saved job context is enough to reopen a session.
      }
      const reopened: JobSession = {
        id: uid('session'),
        tabId: tab.id,
        jobId: job.id,
        url: job.sourceUrl,
        startedAt: stamp,
        updatedAt: stamp,
        pageContext: { title: job.title, url: job.sourceUrl, extractedText: job.description, metadata: job, capturedAt: stamp },
        applicationPageContext,
        events: [{ id: uid('event'), type: 'session_reopened', timestamp: stamp }],
        generatedAnswers: [],
        formFields: [],
        status: 'active',
      };
      await repos.sessions.put(reopened);
      sync('session', reopened.id, reopened);
      setSession(reopened);
      setSelectedJobId(job.id);
      setFields([]);
      setView('session');
      setToast('Application session started');
    } catch (error) {
      notifyError(error);
    }
  };
  const updateJobDetails = async (job: Job, changes: Partial<Job>) => {
    try {
      if (changes.title !== undefined && !changes.title.trim()) throw new Error('Position title cannot be empty.');
      if (changes.company !== undefined && !changes.company.trim()) throw new Error('Company cannot be empty.');
      const updated = { ...job, ...changes, title: changes.title?.trim() || job.title, company: changes.company?.trim() || job.company, lastActivityAt: now() };
      await repos.jobs.put(updated);
      sync('job', job.id, updated);
      setJobs((items) => items.map((item) => item.id === job.id ? updated : item));
      setToast('Job details saved');
    } catch (error) {
      notifyError(error);
    }
  };
  const updateResume = async (resume: Resume, changes: Partial<Resume>) => {
    try {
      const updated = { ...resume, ...changes, updatedAt: now() };
      if (changes.preferred) {
        const updates = resumes.map((item) => ({ ...item, preferred: item.id === resume.id, updatedAt: item.id === resume.id ? updated.updatedAt : item.updatedAt }));
        await Promise.all(updates.map((item) => repos.resumes.put(item)));
        updates.forEach((item) => sync('resume', item.id, { ...item, file: undefined }));
        setResumes(updates);
      } else {
        await repos.resumes.put(updated);
        sync('resume', updated.id, { ...updated, file: undefined });
        setResumes((items) => items.map((item) => item.id === updated.id ? updated : item));
      }
      setToast('Resume updated');
    } catch (error) {
      notifyError(error);
    }
  };
  const exportData = async () => {
    setBusy('export');
    try {
      const [allJobs, allResumes, allSessions, allApplications, allKnowledge, allRules, savedProfile] = await Promise.all([repos.jobs.list(), repos.resumes.list(), repos.sessions.list(), repos.applications.list(), repos.knowledge.list(), repos.fieldRules.list(), repos.profile.get()]);
      const exportedResumes = await Promise.all(allResumes.map(async ({ file, ...resume }) => ({ ...resume, fileData: file?.size ? await blobToDataUrl(file) : undefined })));
      const safeSettings = { ...settings, openRouterApiKey: '', apifyApiKey: '', backendToken: '' };
      const bundle: ExportBundle = { version: 1, exportedAt: now(), jobs: allJobs, resumes: exportedResumes, sessions: allSessions, applications: allApplications, knowledge: allKnowledge, fieldRules: allRules, profile: savedProfile || defaultProfile, settings: safeSettings };
      downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), `orbit-backup-${new Date().toISOString().slice(0, 10)}.json`);
      setToast('Encrypted storage is recommended for the exported backup');
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy('');
    }
  };
  const importData = async (file: File) => {
    setBusy('import');
    try {
      if (file.size > 150 * 1024 * 1024) throw new Error('Backup files must be 150 MB or smaller.');
      const bundle = JSON.parse(await file.text()) as Partial<ExportBundle>;
      if (bundle.version !== 1 || !Array.isArray(bundle.jobs) || !Array.isArray(bundle.resumes)) throw new Error('This is not a supported Orbit backup.');
      for (const job of bundle.jobs) await repos.jobs.put(job);
      for (const exported of bundle.resumes) {
        const { fileData, ...metadata } = exported;
        const blob = fileData ? dataUrlToBlob(fileData) : new Blob([], { type: metadata.mimeType });
        await repos.resumes.put({ ...metadata, file: blob });
      }
      for (const item of bundle.sessions || []) await repos.sessions.put(item);
      for (const item of bundle.applications || []) await repos.applications.put(item);
      for (const item of bundle.knowledge || []) await repos.knowledge.put(item);
      for (const item of bundle.fieldRules || []) await repos.fieldRules.put(item);
      if (bundle.profile) await repos.profile.put({ ...defaultProfile, ...bundle.profile, id: 'default' });
      if (bundle.settings) await repos.settings.put({ ...defaultSettings, ...bundle.settings, openRouterApiKey: settings.openRouterApiKey, apifyApiKey: settings.apifyApiKey, backendToken: settings.backendToken, backendUrl: settings.backendUrl || bundle.settings.backendUrl, syncEnabled: settings.syncEnabled });
      setSession(null);
      setFields([]);
      const [importedJobs, importedResumes, importedProfile, importedSettings, importedKnowledge, importedRules, importedApplications] = await Promise.all([repos.jobs.list(), repos.resumes.list(), repos.profile.get(), repos.settings.get(), repos.knowledge.list(), repos.fieldRules.list(), repos.applications.list()]);
      setJobs(importedJobs.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)));
      setResumes(importedResumes);
      setProfile(importedProfile || defaultProfile);
      setSettings(importedSettings ? { ...defaultSettings, ...importedSettings } : defaultSettings);
      setKnowledge(importedKnowledge);
      setFieldRules(importedRules);
      setApplications(importedApplications.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)));
      setToast('Backup imported locally');
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy('');
    }
  };
  const clearAllData = async () => {
    if (!window.confirm('Permanently delete all Orbit jobs, resumes, sessions, answers and knowledge from this browser and the connected Oracle server?')) return;
    setBusy('clear-data');
    setSession(null);
    setFields([]);
    try {
      await clearBackendData(settings);
      await Promise.all([repos.jobs.clear(), repos.resumes.clear(), repos.sessions.clear(), repos.fields.clear(), repos.fieldRules.clear(), repos.knowledge.clear(), repos.applications.clear(), repos.profile.clear(), repos.settings.clear()]);
      const rules = createDefaultFieldRules();
      await Promise.all(rules.map((rule) => repos.fieldRules.put(rule)));
      setJobs([]); setResumes([]); setKnowledge([]); setApplications([]); setFieldRules(rules); setProfile(defaultProfile); setSettings(defaultSettings); setSession(null); setFields([]); setSelectedJobId(undefined);
      setToast('All Orbit data deleted');
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy('');
    }
  };
  const refreshDashboard = async () => {
    setBusy("refresh");
    try {
      await refresh();
      setToast("View refreshed");
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy("");
    }
  };
  const runParser = async () => {
    setBusy("parser");
    try {
      if (settings.parserExecution === 'server') {
        const configured = await saveBackendParserConfig(settings);
        if (!configured.server_configured) throw new Error('Set APIFY_API_KEY and APIFY_ACTOR on the Oracle server, then restart the API.');
        const result = await runBackendParser(settings);
        await refresh();
        setToast(`Server parser finished: ${result.added} new, ${result.updated} updated`);
        debugLog('Parser', 'Server parser completed', { added: result.added, updated: result.updated, received: result.received });
        return;
      }
      const provider = new ApifyProvider(settings.apifyApiKey, settings.apifyActor);
      const imported = await provider.fetchJobs(settings);
      const next = [...jobs];
      let added = 0;
      let updated = 0;
      for (const item of imported) {
        const candidate = normalizeExternalJob(item as unknown as Record<string, unknown>);
        const existing = findDuplicateJob(candidate, next);
        const job = existing
          ? {
              ...existing,
              ...candidate,
              id: existing.id,
              discoveredAt: existing.discoveredAt,
              status: existing.status,
              statusHistory: existing.statusHistory,
              notes: existing.notes,
              lastActivityAt: now(),
            }
          : candidate;
        await repos.jobs.put(job);
        sync("job", job.id, job);
        const index = next.findIndex((entry) => entry.id === job.id);
        if (index >= 0) {
          next[index] = job;
          updated += 1;
        } else {
          next.push(job);
          added += 1;
        }
      }
      setJobs(next.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)));
      setToast(`Parser finished: ${added} new, ${updated} updated`);
      debugLog('Parser', 'Browser parser completed', { added, updated });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy("");
    }
  };
  const nav = [
    { id: "dashboard" as const, label: "Dashboard", icon: BriefcaseBusiness },
    { id: "resumes" as const, label: "Resumes", icon: FileText },
    { id: "session" as const, label: "Job session", icon: WandSparkles },
    { id: "knowledge" as const, label: "Knowledge", icon: Sparkles },
    { id: "settings" as const, label: "Settings", icon: SettingsIcon },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={17} />
          </div>
          <div>
            <strong>orbit</strong>
            <span>job assistant</span>
          </div>
        </div>
        <button className="analyze-button" onClick={analyze} disabled={!!busy}>
          <Sparkles size={16} />{" "}
          {busy === "analyze" ? "Analyzing…" : "Analyze this job"}
        </button>
        <nav>
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              title={label}
              className={view === id ? "nav-item active" : "nav-item"}
              onClick={() => {
                if (id === 'session' && session?.jobId) setSelectedJobId(session.jobId);
                setView(id);
              }}
            >
              <Icon size={17} />
              {label}
              {id === "session" && session ? (
                <span className="nav-dot" />
              ) : null}
            </button>
          ))}
        </nav>
        <div className="privacy-note">
          <LockKeyhole size={15} />
          <span>
            Local-first by default
            <br />
            <small>LLM calls are explicit</small>
          </span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">PERSONAL AI WORKSPACE</span>
            <h1>
              {view === "dashboard"
                ? "Your application pipeline"
                : nav.find((item) => item.id === view)?.label}
            </h1>
          </div>
          <div className="top-actions">
            <button
              className="icon-button"
              title="Help"
              onClick={() =>
                setToast(
                  "Open a vacancy, choose Analyze this job, then detect and review fields before filling.",
                )
              }
            >
              <CircleHelp size={18} />
            </button>
            <div className="avatar">
              {profile.fullName?.slice(0, 1).toUpperCase() || "Y"}
            </div>
          </div>
        </header>
        {toast && (
          <div className="toast">
            <Check size={16} />
            {toast}
            <button onClick={() => setToast("")}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="content">
          {view === "dashboard" && (
            <Dashboard
              jobs={jobs}
              resumes={resumes}
              query={query}
              setQuery={setQuery}
              onStatus={updateJobStatus}
              onRefresh={refreshDashboard}
              onOpen={(job) => {
                setSelectedJobId(job.id);
                setView("session");
              }}
            />
          )}
          {view === "resumes" && (
            <Resumes
              resumes={resumes}
              profile={profile}
              busy={busy}
              onUpload={uploadResume}
              onUpdate={updateResume}
              onDownload={(resume) => resume.file?.size ? downloadBlob(resume.file, resume.fileName) : setToast('This resume file is not available locally yet')}
              onDelete={async (id) => {
                if (!window.confirm("Delete this resume from local storage?")) return;
                if (applications.some((application) => application.resumeId === id || application.resumeVersionId === id)) {
                  setToast('This resume is part of an application history and cannot be deleted.');
                  return;
                }
                if (resumes.some((resume) => resume.parentId === id)) {
                  setToast('Delete adapted versions before deleting their base resume.');
                  return;
                }
                try {
                  const affectedJobs = jobs.filter((job) => job.resumeId === id || job.resumeVersionId === id);
                  for (const job of affectedJobs) {
                    const updated = { ...job, resumeId: undefined, resumeVersionId: undefined, lastActivityAt: now() };
                    await repos.jobs.put(updated);
                    sync('job', job.id, updated);
                  }
                  if (affectedJobs.length) setJobs((items) => items.map((job) => affectedJobs.some((affected) => affected.id === job.id) ? { ...job, resumeId: undefined, resumeVersionId: undefined, lastActivityAt: now() } : job));
                  await repos.resumes.delete(id);
                  setResumes((items) => items.filter((item) => item.id !== id));
                  deleteRemoteRecord(settings, "resume", id).catch(() => setToast('Resume deleted locally; server deletion is pending'));
                  setToast("Resume deleted");
                } catch (error) {
                  notifyError(error);
                }
              }}
            />
          )}
          {view === "session" && (
            <SessionView
              session={session}
              selectedJobId={selectedJobId}
              jobs={jobs}
              resumes={resumes}
              fields={fields}
              busy={busy}
              onAnalyze={analyze}
              onDetect={detectForm}
              onFill={fillForm}
              onGenerate={generateField}
              applications={applications}
              onSelectResume={selectResume}
              onAdaptResume={adaptResume}
              onCloseSession={closeSession}
              onStartSession={startSessionForJob}
              onUpdateJob={updateJobDetails}
              onRemember={rememberField}
              onChangeField={(id, value, checked) =>
                setFields((items) =>
                  items.map((field) => {
                    const target = items.find((item) => item.id === id);
                    if (target?.type === 'radio' && checked && field.type === 'radio' && field.name === target.name && field.id !== id) return { ...field, checked: false, status: 'review' as const };
                    return field.id === id
                      ? {
                          ...field,
                          value,
                          checked,
                          status: "review",
                          source: "User edit",
                        }
                      : field;
                  }),
                )
              }
              onChangeCategory={(id, category) =>
                setFields((items) =>
                  items.map((field) =>
                    field.id === id
                      ? {
                          ...field,
                          category,
                          status: "review",
                          source: "User category",
                        }
                      : field,
                  ),
                )
              }
              onChangeFieldSettings={(id, changes) =>
                setFields((items) => items.map((field) => field.id === id ? { ...field, ...changes, status: 'review', source: 'User edit' } : field))
              }
              onSave={saveApplication}
            />
          )}
          {view === "settings" && (
            <SettingsView
              settings={settings}
              profile={profile}
              busy={busy}
              onSettings={async (next, syncParser = false) => {
                try {
                  if (next.parserEnabled && !validParserSchedule(next.parserSchedule)) throw new Error('Schedule must be */N * * * * or M H * * * (UTC).');
                  await repos.settings.put(next);
                  setSettings(next);
                  configureDebugLogging(next.debugLogging);
                  if (syncParser && next.syncEnabled && next.backendUrl && next.backendToken) {
                    const parserSettings = next.parserExecution === 'server' ? next : { ...next, parserEnabled: false };
                    const parser = await saveBackendParserConfig(parserSettings);
                    if (next.parserExecution === 'server' && !parser.server_configured) setToast('Settings saved, but Apify is not configured on Oracle yet');
                  }
                  chrome.runtime
                    .sendMessage({ type: "CONFIGURE_PARSER_ALARM" })
                    .catch(() => undefined);
                  if (!syncParser || next.parserExecution !== 'server') setToast("Settings saved");
                } catch (error) {
                  notifyError(error);
                }
              }}
              onProfile={async (next) => {
                try {
                  const updated = { ...next, updatedAt: now() };
                  await repos.profile.put(updated);
                  sync('profile', 'default', updated);
                  setProfile(updated);
                  setToast("Profile saved");
                } catch (error) {
                  notifyError(error);
                }
              }}
              onRunParser={runParser}
              fieldRules={fieldRules}
              onFieldRule={async (rule) => {
                await repos.fieldRules.put(rule);
                sync('field_rule', rule.id, rule);
                setFieldRules((items) => [...items.filter((item) => item.id !== rule.id), rule].sort((a, b) => a.name.localeCompare(b.name)));
                setToast('Field setting saved');
              }}
              onDeleteFieldRule={async (id) => {
                const existing = fieldRules.find((item) => item.id === id);
                if (existing?.id.startsWith('field-rule-default-')) {
                  const disabled = { ...existing, status: 'disabled' as const, updatedAt: now() };
                  await repos.fieldRules.put(disabled);
                  sync('field_rule', disabled.id, disabled);
                  setFieldRules((items) => items.map((item) => item.id === id ? disabled : item));
                  setToast('Default field disabled');
                  return;
                }
                await repos.fieldRules.delete(id);
                setFieldRules((items) => items.filter((item) => item.id !== id));
                deleteRemoteRecord(settings, 'field_rule', id).catch(() => undefined);
              }}
              onExport={exportData}
              onImport={importData}
              onClear={clearAllData}
            />
          )}
          {view === "knowledge" && (
            <KnowledgeView
              items={knowledge}
              onAdd={async () => {
                try {
                  const item: KnowledgeItem = {
                    id: uid("knowledge"),
                    type: "custom",
                    question: "Reusable note",
                    answer: "Add a reusable fact or preferred answer.",
                    tags: [],
                    source: "User",
                    confidence: 1,
                    createdAt: now(),
                    updatedAt: now(),
                  };
                  await repos.knowledge.put(item);
                  sync('knowledge', item.id, item);
                  setKnowledge((items) => [...items, item]);
                } catch (error) {
                  notifyError(error);
                }
              }}
              onDelete={async (id) => {
                try {
                  await repos.knowledge.delete(id);
                  setKnowledge((items) => items.filter((item) => item.id !== id));
                  deleteRemoteRecord(settings, 'knowledge', id).catch(() => undefined);
                } catch (error) {
                  notifyError(error);
                }
              }}
              onUpdate={async (item) => {
                const updated = { ...item, updatedAt: now() };
                await repos.knowledge.put(updated);
                sync('knowledge', updated.id, updated);
                setKnowledge((items) => items.map((entry) => entry.id === updated.id ? updated : entry));
                setToast('Knowledge updated');
              }}
            />
          )}
        </div>
      </main>
      {adaptationDraft && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal adaptation-modal" role="dialog" aria-modal="true" aria-labelledby="adaptation-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">REVIEW BEFORE SAVING</span>
                <h2 id="adaptation-title">Adapted resume for {adaptationDraft.targetTitle}</h2>
                <p className="muted">The original remains unchanged. Edit the draft if needed, then save it as a new DOCX version.</p>
              </div>
              <button className="icon-button" onClick={() => setAdaptationDraft(null)} aria-label="Close adaptation preview"><X size={18} /></button>
            </div>
            {adaptationDraft.changeSummary.length > 0 && <div className="change-summary">{adaptationDraft.changeSummary.map((item) => <span key={item}><Check size={13} />{item}</span>)}</div>}
            <div className="diff-grid">
              <div><strong>Original</strong><pre>{resumes.find((item) => item.id === adaptationDraft.baseResumeId)?.parsedText}</pre></div>
              <label><strong>Adapted</strong><textarea value={adaptationDraft.adaptedText} onChange={(event) => setAdaptationDraft({ ...adaptationDraft, adaptedText: event.target.value })} /></label>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setAdaptationDraft(null)}>Cancel</button>
              <button className="primary-button" onClick={() => void saveAdaptation()} disabled={busy === 'save-adaptation'}>{busy === 'save-adaptation' ? 'Saving…' : 'Save as new version'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  jobs,
  resumes,
  query,
  setQuery,
  onStatus,
  onRefresh,
  onOpen,
}: {
  jobs: Job[];
  resumes: Resume[];
  query: string;
  setQuery: (v: string) => void;
  onStatus: (job: Job, status: Job["status"]) => void;
  onRefresh: () => Promise<void>;
  onOpen: (job: Job) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [remoteFilter, setRemoteFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState("all");
  const [scoreFilter, setScoreFilter] = useState("all");
  const sources = [...new Set(jobs.map((job) => job.source).filter(Boolean))].sort();
  const companies = [...new Set(jobs.map((job) => job.company).filter(Boolean))].sort();
  const locations = [...new Set(jobs.map((job) => job.location).filter(Boolean))].sort();
  const filtered = jobs.filter((job) =>
    `${job.title} ${job.company} ${job.location} ${job.source}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  ).filter((job) =>
    statusFilter === "all" ? true : job.status === statusFilter,
  ).filter((job) =>
    remoteFilter === "all" ? true : job.remoteType === remoteFilter,
  ).filter((job) => sourceFilter === "all" ? true : job.source === sourceFilter)
    .filter((job) => companyFilter === 'all' ? true : job.company === companyFilter)
    .filter((job) => locationFilter === 'all' ? true : job.location === locationFilter)
    .filter((job) => {
      if (dateFilter === "all") return true;
      const days = Number(dateFilter);
      return Date.now() - new Date(job.discoveredAt).getTime() <= days * 24 * 60 * 60 * 1000;
    })
    .filter((job) => scoreFilter === "all" ? true : (job.matchScore || 0) >= Number(scoreFilter));
  const counts = ["Applied", "Interview", "Saved"].map((status) => ({
    status,
    count: jobs.filter((job) => job.status === status).length,
  }));
  const scoredJobs = jobs.filter((job) => typeof job.matchScore === 'number');
  return (
    <>
      <div className="hero-row">
        <div>
          <p className="muted">
            A clear view of every opportunity, from first look to offer.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void onRefresh()}>
          <RefreshCw size={15} /> Refresh view
        </button>
      </div>
      <div className="stats">
        {counts.map((item) => (
          <button className="stat-card" key={item.status} onClick={() => setStatusFilter(item.status)} title={`Show ${item.status} jobs`}>
            <span className={`status-dot ${statusColors[item.status]}`} />
            <div>
              <strong>{item.count}</strong>
              <span>{item.status}</span>
            </div>
            <ChevronRight size={17} />
          </button>
        ))}
        <div className="stat-card insight">
          <Activity size={18} />
          <div>
            <strong>
              {scoredJobs.length
                ? `${Math.round(scoredJobs.reduce((sum, job) => sum + (job.matchScore || 0), 0) / scoredJobs.length)}%`
                : "—"}
            </strong>
            <span>Average match</span>
          </div>
        </div>
      </div>
      <div className="section-heading">
        <div>
          <h2>All opportunities</h2>
          <span className="count-pill">{filtered.length}</span>
        </div>
        <div className="dashboard-filters">
          <label className="search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search company, role, location"
            />
          </label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {[
              "Saved",
              "Analyzing",
              "Applied",
              "Interview",
              "Rejected",
              "Offer",
              "Withdrawn",
              "Archived",
            ].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={remoteFilter} onChange={(event) => setRemoteFilter(event.target.value)}>
            <option value="all">All work modes</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="on-site">On-site</option>
            <option value="unknown">Unknown</option>
          </select>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="all">All sources</option>
            {sources.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
          <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}><option value="all">All companies</option>{companies.map((company) => <option key={company} value={company}>{company}</option>)}</select>
          <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">All locations</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select>
          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
            <option value="all">Any date</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <select value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value)}>
            <option value="all">Any match</option>
            <option value="80">Match 80%+</option>
            <option value="60">Match 60%+</option>
          </select>
        </div>
      </div>
      <div className="job-list">
        {filtered.length ? (
          filtered.map((job) => (
            <article
              className="job-card"
              key={job.id}
              onClick={() => onOpen(job)}
            >
              <div className="company-logo">
                {job.company.slice(0, 1).toUpperCase()}
              </div>
              <div className="job-main">
                <div className="job-title-row">
                  <h3>{job.title}</h3>
                  <span className={`status-badge ${statusColors[job.status]}`}>
                    {job.status}
                  </span>
                </div>
                <p>
                  {job.company} <span>·</span>{" "}
                  {job.location || "Location not listed"}
                </p>
                <div className="job-meta">
                  <span>{job.remoteType}</span>
                  <span>{job.source}</span>
                  {job.salary && <span>{job.salary}</span>}
                  {job.resumeId && <span>{resumes.find((resume) => resume.id === job.resumeId)?.name || 'Resume selected'}</span>}
                  <span>
                    Added {new Date(job.discoveredAt).toLocaleDateString()}
                  </span>
                  {job.appliedAt && <span>Applied {new Date(job.appliedAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="match">
                <strong>
                  {job.matchScore ?? "—"}
                  {typeof job.matchScore === 'number' ? "%" : ""}
                </strong>
                <span>match</span>
              </div>
              <select
                value={job.status}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) =>
                  onStatus(job, event.target.value as Job["status"])
                }
              >
                {[
                  "Saved",
                  "Analyzing",
                  "Applied",
                  "Interview",
                  "Rejected",
                  "Offer",
                  "Withdrawn",
                  "Archived",
                ].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
              <ChevronRight className="card-arrow" size={18} />
            </article>
          ))
        ) : (
          <EmptyState
            icon={<BriefcaseBusiness size={23} />}
            title="Your pipeline is empty"
            text="Open a job page and click Analyze this job to create your first session."
          />
        )}
      </div>
    </>
  );
}

function Resumes({
  resumes,
  profile,
  busy,
  onUpload,
  onUpdate,
  onDownload,
  onDelete,
}: {
  resumes: Resume[];
  profile: UserProfile;
  busy: string;
  onUpload: (file: File) => void;
  onUpdate: (resume: Resume, changes: Partial<Resume>) => void;
  onDownload: (resume: Resume) => void;
  onDelete: (id: string) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const file = Array.from(event.dataTransfer.files).find((item) =>
      /\.(pdf|docx)$/i.test(item.name),
    );
    if (file && busy !== 'upload') onUpload(file);
  };
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };
  return (
    <div
      className="resumes-view"
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragActive(true);
      }}
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <div className={`resume-dropzone${dragActive ? " drag-active" : ""}`}>
        <div className="hero-row">
          <div>
            <p className="muted">
              Keep original documents safe. Adaptations are stored as separate
              versions.
            </p>
            <p className="drop-hint">
              Drop a PDF or DOCX here, or choose a file
            </p>
          </div>
          <label className="primary-button">
            <Upload size={16} />{" "}
            {busy === "upload" ? "Parsing…" : "Upload resume"}
            <input
              hidden
              disabled={busy === 'upload'}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) onUpload(file);
              }}
            />
          </label>
        </div>
      </div>
      <section className="panel extracted-profile-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EXTRACTED PROFILE</span>
            <h2>Reusable application data</h2>
            <p className="muted">
              These values are used for fixed and reusable form fields.
            </p>
          </div>
          <span className="provider-chip">
            <Check size={13} /> Saved locally
          </span>
        </div>
        <div className="fact-grid">
          {[
            ["Full name", profile.fullName],
            ["Email", profile.email],
            ["Phone", profile.phone],
            [
              "Location",
              [profile.city, profile.province].filter(Boolean).join(", "),
            ],
            ["LinkedIn", profile.linkedin],
            ["Skills", profile.skills.join(", ")],
            ["Education", profile.education.join(" · ")],
            ["Experience", profile.experience.slice(0, 2).join(" · ")],
            ["Certifications", profile.certifications.join(" · ")],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div className="profile-fact" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
        </div>
        {!profile.fullName && !profile.email && !profile.phone && (
          <p className="muted">
            Upload a resume with selectable text to populate this profile.
          </p>
        )}
      </section>
      <div className="resume-grid">
        {resumes.map((resume) => (
          <article className="resume-card" key={resume.id}>
            <div className="resume-icon">
              <FileText size={21} />
            </div>
            <div className="resume-card-body">
              <div className="job-title-row">
                <h3>{resume.name}</h3>
                {resume.preferred && (
                  <span className="preferred">Preferred</span>
                )}
              </div>
              <p>
                {resume.fileName} · v{resume.version}
              </p>
              <div className="tag-row">
                {resume.targetRoles.slice(0, 3).map((role) => (
                  <span key={role}>{role}</span>
                ))}
                {resume.structuredData.skills.slice(0, 3).map((skill) => (
                  <span key={skill}>{skill}</span>
                ))}
              </div>
              <small>
                Parsed {resume.parsedText.length.toLocaleString()} characters ·{" "}
                {new Date(resume.updatedAt).toLocaleDateString()}
              </small>
              {resume.adaptationSummary?.length ? <small className="adaptation-note">Adapted: {resume.adaptationSummary.slice(0, 2).join(' · ')}</small> : null}
              <div className="resume-actions">
                <button className="small-button" onClick={() => onDownload(resume)}><Download size={13} /> Download</button>
                <button className="small-button" onClick={() => {
                  const name = window.prompt('Resume name', resume.name)?.trim();
                  if (name && name !== resume.name) onUpdate(resume, { name });
                }}>Rename</button>
                {!resume.preferred && <button className="small-button" onClick={() => onUpdate(resume, { preferred: true })}>Set preferred</button>}
              </div>
            </div>
            <button
              className="icon-button danger"
              title="Delete resume"
              onClick={() => onDelete(resume.id)}
            >
              <Trash2 size={16} />
            </button>
          </article>
        ))}
        {!resumes.length && (
          <EmptyState
            icon={<FileText size={23} />}
            title="Add your first resume"
            text="PDF and DOCX are parsed locally, then reusable profile data is extracted."
          />
        )}
      </div>
    </div>
  );
}

function SessionView({
  session,
  selectedJobId,
  jobs,
  resumes,
  fields,
  busy,
  onAnalyze,
  onDetect,
  onFill,
  onGenerate,
  applications,
  onSelectResume,
  onAdaptResume,
  onCloseSession,
  onStartSession,
  onUpdateJob,
  onRemember,
  onChangeField,
  onChangeCategory,
  onChangeFieldSettings,
  onSave,
}: {
  session: JobSession | null;
  selectedJobId?: string;
  jobs: Job[];
  resumes: Resume[];
  fields: FormField[];
  busy: string;
  onAnalyze: () => void;
  onDetect: () => void;
  onFill: () => void;
  onGenerate: (field: FormField) => void;
  applications: ApplicationRecord[];
  onSelectResume: (job: Job, resumeId: string) => void;
  onAdaptResume: (job: Job) => void;
  onCloseSession: () => void;
  onStartSession: (job: Job) => void;
  onUpdateJob: (job: Job, changes: Partial<Job>) => void;
  onRemember: (field: FormField, mode: 'answer' | 'preference') => void;
  onChangeField: (id: string, value: string, checked?: boolean) => void;
  onChangeCategory: (id: string, category: FormField["category"]) => void;
  onChangeFieldSettings: (id: string, changes: Pick<FormField, 'prompt' | 'instructions'>) => void;
  onSave: () => void;
}) {
  const [expandedFieldId, setExpandedFieldId] = useState<string>();
  const [notesDraft, setNotesDraft] = useState('');
  const [jobDraft, setJobDraft] = useState({ title: '', company: '', location: '', salary: '', applicationUrl: '' });
  const job = jobs.find((item) => item.id === (selectedJobId || session?.jobId));
  const activeSession = session?.jobId === job?.id ? session : null;
  const visibleFields = activeSession ? fields : [];
  useEffect(() => setNotesDraft(job?.notes || ''), [job?.id, job?.notes]);
  useEffect(() => setJobDraft({ title: job?.title || '', company: job?.company || '', location: job?.location || '', salary: job?.salary || '', applicationUrl: job?.applicationUrl || '' }), [job?.id, job?.title, job?.company, job?.location, job?.salary, job?.applicationUrl]);
  const best = job?.matches?.find((match) => match.resumeId === job.resumeId) || job?.matches?.[0];
  const jobApplications = applications.filter((application) => application.jobId === job?.id);
  if (!job)
    return (
      <EmptyState
        icon={<WandSparkles size={23} />}
        title="No active job session"
        text="Open a vacancy in the active tab, then use Analyze this job."
        action={
          <button className="primary-button" onClick={onAnalyze}>
            <Sparkles size={16} /> Analyze current tab
          </button>
        }
      />
    );
  return (
    <>
      <div className="session-banner">
        <div className="session-icon">
          <Sparkles size={20} />
        </div>
        <div>
          <span className="eyebrow">
            {activeSession ? "ACTIVE SESSION" : "JOB DETAILS"}
          </span>
          <h2>{job.title}</h2>
          <p>
            {job.company} · {job.location || "Location not listed"}
          </p>
          <div className="job-links">
            {job.sourceUrl && <a href={job.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Job page</a>}
            {job.applicationUrl && job.applicationUrl !== job.sourceUrl && <a href={job.applicationUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Application</a>}
          </div>
        </div>
        <div className="session-actions">
          <span className="live-pill"><span /> {activeSession ? "Live" : job.status}</span>
          {activeSession && <button className="secondary-button" onClick={onCloseSession}>Close session</button>}
          {!activeSession && <button className="primary-button" onClick={() => onStartSession(job)}>Start application session</button>}
        </div>
      </div>
      <div className="session-grid">
        <section className="panel analysis-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">JOB ANALYSIS</span>
              <h2>{job.analysis?.summary || "Analysis pending"}</h2>
            </div>
            <span className="provider-chip">
              <Sparkles size={13} /> {job.analysis ? "Ready" : "Pending"}
            </span>
          </div>
          {job.analysis ? (
            <>
              <div className="analysis-score">
                <div className="score-ring">
                  <strong>{best?.score ?? "—"}</strong>
                  <span>/100</span>
                </div>
                <div>
                  <strong>
                    {best?.recommendation || "Review available resumes"}
                  </strong>
                  <p>
                    Explainable score based on requirements, skills and relevant
                    experience.
                  </p>
                </div>
              </div>
              <div className="analysis-columns">
                <div>
                  <label>Must-have requirements</label>
                  {job.analysis.mandatoryRequirements
                    .slice(0, 6)
                    .map((item) => (
                      <span className="check-line" key={item}>
                        <Check size={14} />
                        {item}
                      </span>
                    ))}
                </div>
                <div>
                  <label>Keywords</label>
                  <div className="tag-row">
                    {job.analysis.keywords.slice(0, 10).map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <button
              className="primary-button"
              onClick={onAnalyze}
              disabled={!!busy}
            >
              <Sparkles size={15} /> Run analysis
            </button>
          )}
        </section>
        <section className="panel resume-match-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">RESUME POOL</span>
              <h2>Best matches</h2>
            </div>
            <div className="button-row">
              <span className="count-pill">{job.matches?.length || 0}</span>
              {job.resumeId && <button className="small-button" onClick={() => onAdaptResume(job)} disabled={busy === 'adapt'}><WandSparkles size={13} />{busy === 'adapt' ? 'Adapting…' : 'Adapt'}</button>}
            </div>
          </div>
          {job.matches?.length ? (
            job.matches.map((match) => {
              const resume = resumes.find((item) => item.id === match.resumeId);
              return (
                <button
                  className={`match-row${job.resumeId === match.resumeId ? " selected" : ""}`}
                  key={match.resumeId}
                  onClick={() => onSelectResume(job, match.resumeId)}
                  title="Use this resume for the application"
                >
                  <div className="mini-file">
                    <FileText size={15} />
                  </div>
                  <div>
                    <strong>{resume?.name || "Resume"}</strong>
                    <p>
                      {match.matchingSkills.slice(0, 3).join(" · ") ||
                        "Review fit details"}
                    </p>
                  </div>
                  <div className="mini-score">{match.score}%</div>
                </button>
              );
            })
          ) : (
            <p className="muted">
              Upload a resume to compare it with this role.
            </p>
          )}
          {best && <div className="match-explanation">
            {best.strengths.length > 0 && <p><strong>Strengths:</strong> {best.strengths.slice(0, 3).join(' · ')}</p>}
            {best.missingRequirements.length > 0 && <p><strong>Missing:</strong> {best.missingRequirements.slice(0, 3).join(' · ')}</p>}
            {best.concerns.length > 0 && <p><strong>Review:</strong> {best.concerns.slice(0, 2).join(' · ')}</p>}
          </div>}
        </section>
      </div>
      <section className="panel job-details-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">JOB DETAILS</span><h2>Notes and application history</h2></div>
          <button className="small-button" onClick={() => onUpdateJob(job, { ...jobDraft, salary: jobDraft.salary || undefined, applicationUrl: jobDraft.applicationUrl || undefined, notes: notesDraft })}>Save details</button>
        </div>
        <div className="job-edit-grid">
          <label><span>Position</span><input value={jobDraft.title} onChange={(event) => setJobDraft({ ...jobDraft, title: event.target.value })} /></label>
          <label><span>Company</span><input value={jobDraft.company} onChange={(event) => setJobDraft({ ...jobDraft, company: event.target.value })} /></label>
          <label><span>Location</span><input value={jobDraft.location} onChange={(event) => setJobDraft({ ...jobDraft, location: event.target.value })} /></label>
          <label><span>Salary</span><input value={jobDraft.salary} onChange={(event) => setJobDraft({ ...jobDraft, salary: event.target.value })} /></label>
          <label className="wide-field"><span>Application URL</span><input value={jobDraft.applicationUrl} onChange={(event) => setJobDraft({ ...jobDraft, applicationUrl: event.target.value })} /></label>
        </div>
        <textarea className="notes-editor" value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} placeholder="Interview contacts, follow-up reminders, salary notes…" />
        <div className="history-grid">
          <div>
            <strong>Status history</strong>
            {(job.statusHistory || []).length ? [...job.statusHistory].reverse().slice(0, 8).map((entry) => <span key={`${entry.timestamp}-${entry.newStatus}`}>{new Date(entry.timestamp).toLocaleString()} · {entry.previousStatus} → {entry.newStatus}</span>) : <span>No status changes yet</span>}
          </div>
          <div>
            <strong>Applications</strong>
            {jobApplications.length ? jobApplications.map((application) => <details key={application.id}><summary>{new Date(application.submittedAt).toLocaleString()} · {application.answers.length} answers</summary>{application.answers.map((answer) => <p key={`${application.id}-${answer.fieldId}`}><b>{answer.question}</b><br />{answer.answer}</p>)}</details>) : <span>No submitted application saved yet</span>}
          </div>
        </div>
      </section>
      <section className="panel assistant-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">APPLICATION ASSISTANT</span>
            <h2>Detect and fill the current form</h2>
            <p className="muted">
              The assistant only reads and fills fields. You remain in control
              of Submit.
            </p>
          </div>
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={onDetect}
              disabled={busy === "detect" || !activeSession}
            >
              <Search size={15} />{" "}
              {busy === "detect" ? "Detecting…" : "Detect fields"}
            </button>
            {visibleFields.length > 0 && (
              <button
                className="primary-button"
                onClick={onFill}
                disabled={busy === "fill"}
              >
                <WandSparkles size={15} /> Fill application
              </button>
            )}
          </div>
        </div>
        {visibleFields.length > 0 && (
          <>
            <div className="field-summary">
              <strong>{visibleFields.length} fields detected</strong>
              <span>
                {visibleFields.filter((field) => field.category !== "ignore").length}{" "}
                can be assisted
              </span>
              <span>
                {visibleFields.filter((field) => field.confidence < 0.8).length}{" "}
                require review
              </span>
            </div>
            <div className="fields-table">
              {visibleFields.map((field) => (
                <React.Fragment key={field.id}>
                <div className="field-row">
                  <div className="field-kind">
                    <span className={`kind-icon ${field.category}`}>
                      <IconFor category={field.category} />
                    </span>
                    <select
                      className="field-category-select"
                      value={field.category}
                      aria-label={`Field type for ${field.label}`}
                      onChange={(event) =>
                        onChangeCategory(
                          field.id,
                          event.target.value as FormField["category"],
                        )
                      }
                    >
                      <option value="fixed">Fixed</option>
                      <option value="reusable">Reusable</option>
                      <option value="llm">LLM Generated</option>
                      <option value="ignore">Ignore</option>
                    </select>
                  </div>
                  <div className="field-label">
                    <strong title={field.label}>{field.label}</strong>
                    <small>
                      {field.name || field.type} ·{" "}
                      {Math.round(field.confidence * 100)}% confidence
                      {field.source ? ` · ${field.source}` : ''}
                    </small>
                  </div>
                  {field.type === 'file' ? (
                    <div className="file-value"><Paperclip size={14} /><span>{field.value || 'Select a resume above, then Fill preview'}</span></div>
                  ) : field.type === 'select' ? (
                    <select className="field-value-select" value={field.value} onChange={(event) => onChangeField(field.id, event.target.value)}>
                      <option value="">Choose…</option>
                      {(field.options || []).map((option) => <option key={`${option.value}-${option.label}`} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : field.type === "checkbox" || field.type === "radio" ? (
                    <label className="choice-value">
                      <input
                        type={field.type}
                        checked={Boolean(field.checked)}
                        onChange={(event) =>
                          onChangeField(
                            field.id,
                            field.value,
                            event.target.checked,
                          )
                        }
                      />
                      <span>{field.checked ? "Selected" : "Not selected"}</span>
                    </label>
                  ) : field.type === "textarea" || field.type === "contenteditable" || field.category === "llm" ? (
                    <textarea
                      value={field.value}
                      rows={field.category === "llm" ? 3 : 2}
                      onChange={(event) =>
                        onChangeField(field.id, event.target.value)
                      }
                      placeholder={
                        field.category === "llm"
                          ? "Generate an answer or type your own"
                          : "No value available"
                      }
                    />
                  ) : (
                    <input
                      value={field.value}
                      onChange={(event) =>
                        onChangeField(field.id, event.target.value)
                      }
                      placeholder="No value available"
                    />
                  )}
                  <div className="field-actions">
                    {field.type !== 'file' && field.category !== 'ignore' && <button
                      className="small-button"
                      onClick={() => onGenerate(field)}
                      disabled={busy === `field-${field.id}`}
                    >
                      {busy === `field-${field.id}`
                        ? "…"
                        : field.category === "llm"
                          ? field.value ? "Regenerate" : "Generate"
                          : "Suggest"}
                    </button>}
                    <button className="icon-button" title="Prompt and memory" aria-label={`Prompt and memory for ${field.label}`} onClick={() => setExpandedFieldId(expandedFieldId === field.id ? undefined : field.id)}><SettingsIcon size={14} /></button>
                  </div>
                </div>
                {expandedFieldId === field.id && <div className="field-config">
                  <label><span>Custom prompt</span><textarea value={field.prompt || ''} onChange={(event) => onChangeFieldSettings(field.id, { prompt: event.target.value })} placeholder="Example: Keep this under 120 words and emphasize project coordination." /></label>
                  <label><span>Field instructions</span><input value={field.instructions || ''} onChange={(event) => onChangeFieldSettings(field.id, { instructions: event.target.value })} placeholder="Character limit, required format, or facts to include" /></label>
                  <div className="button-row memory-actions">
                    {field.category === 'llm' ? <>
                      <button className="small-button" disabled={!field.value.trim()} onClick={() => onRemember(field, 'answer')}>Save answer</button>
                      <button className="small-button" disabled={!field.prompt?.trim() && !field.instructions?.trim()} onClick={() => onRemember(field, 'preference')}>Save prompt preference</button>
                    </> : <button className="small-button" disabled={!field.value.trim()} onClick={() => onRemember(field, 'answer')}>Remember this value</button>}
                    <span className="muted">Saving is explicit; normal edits do not become permanent automatically.</span>
                  </div>
                </div>}
                </React.Fragment>
              ))}
            </div>
            <div className="submit-bar">
              {activeSession ? (
                <>
                  <div>
                    <strong>Ready to save?</strong>
                    <span>
                      Review every answer and submit on the site yourself.
                    </span>
                  </div>
                  <button
                    className="primary-button"
                    onClick={onSave}
                    disabled={busy === "save"}
                  >
                    <Send size={15} /> Application submitted
                  </button>
                </>
              ) : (
                <span className="muted">
                  Start a session to link this form to an application.
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
}

const IconFor = ({ category }: { category: FormField["category"] }) =>
  category === "fixed" ? (
    <LockKeyhole size={13} />
  ) : category === "llm" ? (
    <Sparkles size={13} />
  ) : category === "reusable" ? (
    <RefreshCw size={13} />
  ) : (
    <X size={13} />
  );
function SettingsView({
  settings,
  profile,
  busy,
  onSettings,
  onProfile,
  onRunParser,
  fieldRules,
  onFieldRule,
  onDeleteFieldRule,
  onExport,
  onImport,
  onClear,
}: {
  settings: Settings;
  profile: UserProfile;
  busy: string;
  onSettings: (value: Settings, syncParser?: boolean) => void;
  onProfile: (value: UserProfile) => void;
  onRunParser: () => Promise<void>;
  fieldRules: FieldRule[];
  onFieldRule: (value: FieldRule) => void;
  onDeleteFieldRule: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onClear: () => void;
}) {
  const [tab, setTab] = useState<"profile" | "llm" | "parser" | "fields" | "sync">("profile");
  const [local, setLocal] = useState(settings);
  const [person, setPerson] = useState(profile);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsMessage, setModelsMessage] = useState("");
  const patch = (key: keyof Settings, value: unknown) =>
    setLocal((current) => ({ ...current, [key]: value }));
  const patchPerson = (key: keyof UserProfile, value: string) =>
    setPerson((current) => ({ ...current, [key]: value }));
  useEffect(() => setLocal(settings), [settings]);
  useEffect(() => setPerson(profile), [profile]);
  const loadModels = async () => {
    setModelsBusy(true);
    setModelsMessage("");
    try {
      setModels(await fetchOpenRouterModels(local.openRouterApiKey));
      setModelsMessage("Models loaded");
    } catch (error) {
      setModelsMessage(error instanceof Error ? error.message : "Unable to load models");
    } finally {
      setModelsBusy(false);
    }
  };
  return (
    <>
      <div className="settings-tabs">
        {[
          ["profile", "User profile", UserRound],
          ["llm", "LLM provider", Sparkles],
          ["parser", "Job parser", Activity],
          ["fields", "Field settings", LockKeyhole],
          ["sync", "Cloud sync", RefreshCw],
        ].map(([id, label, Icon]) => (
          <button
            key={id as string}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id as typeof tab)}
          >
            {React.createElement(Icon as typeof UserRound, { size: 16 })}
            {label as string}
          </button>
        ))}
      </div>
      {tab === "profile" && (
        <div className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PERSONAL DATA</span>
              <h2>User profile</h2>
              <p className="muted">
                Fixed values are used for high-confidence autofill.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => onProfile(person)}
            >
              Save profile
            </button>
          </div>
          <div className="form-grid">
            {(
              [
                "firstName",
                "lastName",
                "fullName",
                "email",
                "phone",
                "address",
                "city",
                "province",
                "postalCode",
                "linkedin",
                "portfolio",
                "website",
                "workAuthorization",
              ] as const
            ).map((key) => (
              <label key={key}>
                <span>
                  {key
                    .replace(/[A-Z]/g, (m) => ` ${m}`)
                    .replace(/^./, (m) => m.toUpperCase())}
                </span>
                <input
                  value={person[key]}
                  onChange={(event) => patchPerson(key, event.target.value)}
                />
              </label>
            ))}
          </div>
          <label className="wide-field">
            <span>Skills (comma separated)</span>
            <input
              value={person.skills.join(", ")}
              onChange={(event) =>
                setPerson({
                  ...person,
                  skills: event.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          {([
            ['education', 'Education (one item per line)'],
            ['experience', 'Experience (one item per line)'],
            ['certifications', 'Certifications (one item per line)'],
            ['preferences', 'Application preferences (one item per line)'],
          ] as const).map(([key, label]) => <label className="wide-field" key={key}>
            <span>{label}</span>
            <textarea value={person[key].join('\n')} rows={3} onChange={(event) => setPerson((current) => ({ ...current, [key]: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) }))} />
          </label>)}
        </div>
      )}
      {tab === "llm" && (
        <div className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PROVIDER</span>
              <h2>LLM settings</h2>
              <p className="muted">
                {local.syncEnabled
                  ? "Cloud sync is enabled; LLM requests use the Oracle gateway."
                  : "Keys stay in this browser's IndexedDB and are sent only to the selected provider."}
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => onSettings(local)}
            >
              Save settings
            </button>
          </div>
          <div className="form-grid">
            <label>
              <span>Provider</span>
            <select value={local.llmProvider}>
                <option value="openrouter">OpenRouter</option>
              </select>
            </label>
            <label>
              <span>OpenRouter model</span>
              <div className="input-action">
                <input
                  list="openrouter-models"
                  value={local.openRouterModel}
                  onChange={(event) =>
                    patch("openRouterModel", event.target.value)
                  }
                  placeholder="e.g. openai/..."
                />
                <button
                  className="small-button"
                  type="button"
                  onClick={loadModels}
                  disabled={modelsBusy}
                >
                  {modelsBusy ? "Loading…" : "Load models"}
                </button>
                <datalist id="openrouter-models">
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </datalist>
              </div>
              {modelsMessage && <small className="settings-message">{modelsMessage}</small>}
            </label>
            <label className="wide-field">
              <span>API key</span>
              <input
                type="password"
                value={local.openRouterApiKey}
                onChange={(event) =>
                  patch("openRouterApiKey", event.target.value)
                }
                placeholder="sk-or-…"
              />
            </label>
            <label>
              <span>Temperature</span>
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={local.temperature}
                onChange={(event) =>
                  patch("temperature", Number(event.target.value))
                }
              />
            </label>
            <label>
              <span>Max tokens</span>
              <input
                type="number"
                min="100"
                max="8000"
                value={local.maxTokens}
                onChange={(event) =>
                  patch("maxTokens", Number(event.target.value))
                }
              />
            </label>
            <label>
              <span>Debug logging</span>
              <select value={String(local.debugLogging)} onChange={(event) => patch('debugLogging', event.target.value === 'true')}><option value="false">Off</option><option value="true">On (no sensitive values)</option></select>
            </label>
          </div>
          <div className="callout">
            <Sparkles size={16} />
            <span>
              No key? Orbit uses a local heuristic fallback, so your data
              remains local while you test the workflow.
            </span>
          </div>
        </div>
      )}
      {tab === "parser" && (
        <div className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">JOB DISCOVERY</span>
              <h2>Apify parser</h2>
              <p className="muted">
                Configure Apify, save the settings, then run discovery manually.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => onSettings(local, true)}
            >
              Save settings
            </button>
          </div>
          <div className="form-grid">
            <label>
              <span>Execution</span>
              <select value={local.parserExecution} onChange={(event) => patch('parserExecution', event.target.value as Settings['parserExecution'])}>
                <option value="browser">This browser</option>
                <option value="server">Oracle server</option>
              </select>
            </label>
            <label>
              <span>Enabled</span>
              <select
                value={String(local.parserEnabled)}
                onChange={(event) =>
                  patch("parserEnabled", event.target.value === "true")
                }
              >
                <option value="false">Off</option>
                <option value="true">On</option>
              </select>
            </label>
            <label>
              <span>Schedule (cron, UTC)</span>
              <input
                value={local.parserSchedule}
                onChange={(event) =>
                  patch("parserSchedule", event.target.value)
                }
              />
            </label>
            <label className="wide-field">
              <span>Apify API key {local.parserExecution === 'server' ? '(configured in backend/.env)' : ''}</span>
              <input
                type="password"
                value={local.apifyApiKey}
                onChange={(event) => patch("apifyApiKey", event.target.value)}
                disabled={local.parserExecution === 'server'}
              />
            </label>
            <label className="wide-field">
              <span>Actor ID</span>
              <input
                value={local.apifyActor}
                onChange={(event) => patch("apifyActor", event.target.value)}
                placeholder="username/actor-name"
              />
            </label>
            <label>
              <span>Job titles</span>
              <input
                value={local.jobTitles.join(", ")}
                onChange={(event) =>
                  patch(
                    "jobTitles",
                    event.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
            <label>
              <span>Locations</span>
              <input
                value={local.locations.join(", ")}
                onChange={(event) =>
                  patch(
                    "locations",
                    event.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
            <label>
              <span>Keywords</span>
              <input
                value={local.keywords.join(", ")}
                onChange={(event) =>
                  patch("keywords", event.target.value.split(",").map((v) => v.trim()).filter(Boolean))
                }
              />
            </label>
            <label>
              <span>Remote types</span>
              <input
                value={local.remoteTypes.join(", ")}
                onChange={(event) =>
                  patch("remoteTypes", event.target.value.split(",").map((v) => v.trim()).filter(Boolean))
                }
              />
            </label>
            <label>
              <span>Platforms</span>
              <input
                value={local.platforms.join(", ")}
                onChange={(event) =>
                  patch("platforms", event.target.value.split(",").map((v) => v.trim()).filter(Boolean))
                }
              />
            </label>
            <label>
              <span>Exclude keywords</span>
              <input
                value={local.excludeKeywords.join(", ")}
                onChange={(event) =>
                  patch("excludeKeywords", event.target.value.split(",").map((v) => v.trim()).filter(Boolean))
                }
              />
            </label>
            <label>
              <span>Minimum salary</span>
              <input
                type="number"
                min="0"
                value={local.minimumSalary ?? ""}
                onChange={(event) => patch("minimumSalary", event.target.value ? Number(event.target.value) : undefined)}
              />
            </label>
          </div>
          <div className="button-row parser-actions">
            <button
              className="secondary-button"
              onClick={() => void onRunParser()}
              disabled={busy === "parser"}
            >
              {busy === "parser" ? "Running…" : "Run parser now"}
            </button>
            <span className="muted">Manual run uses the saved Apify settings.</span>
          </div>
        </div>
      )}
      {tab === 'fields' && <FieldSettings rules={fieldRules} onSave={onFieldRule} onDelete={onDeleteFieldRule} />}
      {tab === 'sync' && <>
        <ServerSyncPanel
          settings={local}
          onChange={(key, value) => patch(key, value)}
          onSave={() => onSettings(local)}
          onConnect={(token) => {
            const connected = { ...local, backendToken: token, syncEnabled: true };
            setLocal(connected);
            onSettings(connected);
          }}
        />
        <div className="panel settings-panel data-panel">
          <div className="panel-heading"><div><span className="eyebrow">DATA MANAGEMENT</span><h2>Backup and reset</h2><p className="muted">Exports include resume files and application answers, but omit API keys and session tokens.</p></div></div>
          <div className="button-row data-actions">
            <button className="secondary-button" onClick={onExport} disabled={busy === 'export'}>{busy === 'export' ? 'Exporting…' : 'Export data'}</button>
            <label className="secondary-button">{busy === 'import' ? 'Importing…' : 'Import data'}<input hidden type="file" accept="application/json,.json" disabled={busy === 'import'} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) onImport(file); }} /></label>
            <button className="secondary-button danger-button" onClick={onClear} disabled={busy === 'clear-data'}>{busy === 'clear-data' ? 'Deleting…' : 'Clear all data'}</button>
          </div>
        </div>
      </>}
    </>
  );
}

function FieldSettings({ rules, onSave, onDelete }: { rules: FieldRule[]; onSave: (rule: FieldRule) => void; onDelete: (id: string) => void }) {
  return <div className="panel settings-panel field-settings-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">KNOWN APPLICATION FIELDS</span><h2>Field behavior and reusable values</h2><p className="muted">Rules are applied to newly detected forms. Changes during an application can also be saved here explicitly.</p></div>
      <button className="primary-button" onClick={() => {
        const stamp = now();
        onSave({ id: uid('field-rule'), name: 'New field', aliases: [], category: 'reusable', value: '', status: 'active', source: 'User', editable: true, llmEnabled: false, createdAt: stamp, updatedAt: stamp });
      }}><Plus size={15} /> Add field</button>
    </div>
    <div className="field-rule-list">
      {rules.map((rule) => <FieldRuleRow key={rule.id} rule={rule} onSave={onSave} onDelete={onDelete} />)}
    </div>
  </div>;
}

function FieldRuleRow({ rule, onSave, onDelete }: { rule: FieldRule; onSave: (rule: FieldRule) => void; onDelete: (id: string) => void }) {
  const [draft, setDraft] = useState(rule);
  const [open, setOpen] = useState(false);
  useEffect(() => setDraft(rule), [rule]);
  const patch = (changes: Partial<FieldRule>) => setDraft((current) => ({ ...current, ...changes }));
  return <article className="field-rule-card">
    <div className="field-rule-main">
      <input aria-label="Field name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
      <select value={draft.category} onChange={(event) => patch({ category: event.target.value as FieldRule['category'], llmEnabled: event.target.value === 'llm' })}>
        <option value="fixed">Fixed</option><option value="reusable">Reusable</option><option value="llm">LLM Generated</option><option value="ignore">Ignore</option>
      </select>
      <select value={draft.status} onChange={(event) => patch({ status: event.target.value as FieldRule['status'] })}><option value="active">Active</option><option value="disabled">Disabled</option></select>
      <input aria-label="Reusable value" value={draft.value} onChange={(event) => patch({ value: event.target.value })} placeholder={draft.category === 'llm' ? 'Generated at application time' : 'Reusable value'} disabled={draft.category === 'llm'} />
      <button className="small-button" onClick={() => setOpen((value) => !value)}>Details</button>
    </div>
    {open && <div className="field-rule-details">
      <label><span>Aliases (comma separated)</span><input value={draft.aliases.join(', ')} onChange={(event) => patch({ aliases: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
      <label><span>Prompt</span><textarea value={draft.prompt || ''} onChange={(event) => patch({ prompt: event.target.value })} /></label>
      <label><span>Instructions</span><textarea value={draft.instructions || ''} onChange={(event) => patch({ instructions: event.target.value })} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={draft.llmEnabled} onChange={(event) => patch({ llmEnabled: event.target.checked })} /> LLM enabled</label>
    </div>}
    <div className="field-rule-footer"><small>{draft.source}</small><div className="button-row"><button className="icon-button danger" title="Delete field rule" onClick={() => onDelete(rule.id)}><Trash2 size={15} /></button><button className="small-button" onClick={() => onSave({ ...draft, updatedAt: now() })}>Save</button></div></div>
  </article>;
}

function KnowledgeView({
  items,
  onAdd,
  onDelete,
  onUpdate,
}: {
  items: KnowledgeItem[];
  onAdd: () => void;
  onDelete: (id: string) => void;
  onUpdate: (item: KnowledgeItem) => void;
}) {
  return (
    <>
      <div className="hero-row">
        <div>
          <p className="muted">
            Reusable answers and professional facts you choose to keep between
            applications.
          </p>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <Plus size={16} /> Add knowledge
        </button>
      </div>
      <div className="knowledge-list">
        {items.map((item) => <KnowledgeCard key={item.id} item={item} onSave={onUpdate} onDelete={onDelete} />)}
        {!items.length && (
          <EmptyState
            icon={<Sparkles size={23} />}
            title="Your knowledge base is quiet"
            text="Save preferred answers and reusable facts here as you work through applications."
          />
        )}
      </div>
    </>
  );
}

function KnowledgeCard({ item, onSave, onDelete }: { item: KnowledgeItem; onSave: (item: KnowledgeItem) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(item.answer === 'Add a reusable fact or preferred answer.');
  const [draft, setDraft] = useState(item);
  useEffect(() => setDraft(item), [item]);
  if (!editing) return <article className="knowledge-card">
    <div className="knowledge-type">{item.type.replace('_', ' ')}</div>
    <div><strong>{item.question || 'Reusable knowledge'}</strong><p>{item.answer}</p><small>{item.tags.join(' · ') || 'No tags'} · {item.source}</small></div>
    <div className="button-row"><button className="icon-button" title="Edit" onClick={() => setEditing(true)}><SettingsIcon size={15} /></button><button className="icon-button danger" title="Delete" onClick={() => onDelete(item.id)}><Trash2 size={16} /></button></div>
  </article>;
  return <article className="knowledge-card knowledge-editor">
    <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as KnowledgeItem['type'] })}>{['personal','professional','experience','achievement','preference','application_answer','cover_letter_fragment','custom'].map((type) => <option value={type} key={type}>{type.replace('_', ' ')}</option>)}</select>
    <div>
      <input value={draft.question || ''} onChange={(event) => setDraft({ ...draft, question: event.target.value })} placeholder="Question or title" />
      <textarea value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} placeholder="Reusable fact, answer, or preference" />
      <input value={draft.tags.join(', ')} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="Tags, comma separated" />
    </div>
    <div className="button-row"><button className="icon-button danger" title="Delete" onClick={() => onDelete(item.id)}><Trash2 size={16} /></button><button className="small-button" disabled={!draft.answer.trim()} onClick={() => { onSave(draft); setEditing(false); }}>Save</button></div>
  </article>;
}
function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}

function ServerSyncPanel({
  settings,
  onChange,
  onSave,
  onConnect,
}: {
  settings: Settings;
  onChange: (key: keyof Settings, value: unknown) => void;
  onSave: () => void;
  onConnect: (token: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const login = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await loginBackend(settings.backendUrl, email, password);
      onConnect(result.access_token);
      setPassword("");
      setMessage("Connected");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel settings-panel server-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ORACLE SERVER</span>
          <h2>Cloud sync</h2>
          <p className="muted">
            Sign in once on each computer. Records are saved locally first and
            never blocked by a server outage.
          </p>
        </div>
        <button className="primary-button" onClick={onSave}>
          Save sync
        </button>
      </div>
      <div className="form-grid">
        <label>
          <span>Enabled</span>
          <select
            value={String(settings.syncEnabled)}
            onChange={(event) =>
              onChange("syncEnabled", event.target.value === "true")
            }
          >
            <option value="false">Off</option>
            <option value="true">On</option>
          </select>
        </label>
        <label>
          <span>API URL</span>
          <input
            value={settings.backendUrl}
            onChange={(event) => onChange("backendUrl", event.target.value)}
            placeholder="https://api.example.com"
          />
        </label>
        <label>
          <span>Account email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Server account password"
          />
        </label>
        <label className="wide-field">
          <span>Session token</span>
          <input
            type="password"
            value={settings.backendToken}
            onChange={(event) => onChange("backendToken", event.target.value)}
            placeholder="Filled after sign in"
          />
        </label>
      </div>
      <div className="button-row">
        <button
          className="secondary-button"
          onClick={login}
          disabled={busy || !settings.backendUrl || !email || !password}
        >
          {busy ? "Signing in…" : "Sign in to Oracle"}
        </button>
        {message && <span className="muted">{message}</span>}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
