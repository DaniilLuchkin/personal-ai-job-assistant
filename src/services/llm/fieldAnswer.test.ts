import { describe, expect, it } from 'vitest';
import { cleanFieldAnswer, inferFieldAnswerKind, isUsefulFieldAnswer } from './fieldAnswer';
import type { FieldAnswerInput } from './LLMProvider';

describe('field answer helpers', () => {
  it('classifies about-yourself questions in English and Russian', () => {
    expect(inferFieldAnswerKind('Tell us about yourself')).toBe('candidate_summary');
    expect(inferFieldAnswerKind('Расскажите нам о себе')).toBe('candidate_summary');
  });

  it('removes reasoning wrappers and answer prefixes', () => {
    expect(cleanFieldAnswer('<think>private reasoning</think> Answer: I coordinate complex projects.')).toBe('I coordinate complex projects.');
    expect(cleanFieldAnswer('{"answer":"I work with Jira and Excel."}')).toBe('I work with Jira and Excel.');
  });

  it('rejects broken or too-short candidate summaries', () => {
    const input = { answerKind: 'candidate_summary' } as FieldAnswerInput;
    expect(isUsefulFieldAnswer('���', input)).toBe(false);
    expect(isUsefulFieldAnswer('Project manager.', input)).toBe(false);
    expect(isUsefulFieldAnswer('I am a project manager with experience coordinating cross-functional teams, improving delivery workflows, managing stakeholder communication, and supporting complex operational projects from planning through completion.', input)).toBe(true);
  });
});
