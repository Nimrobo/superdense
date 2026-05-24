import { describe, expect, it } from 'vitest';
import { extractFirstMeaningfulPrompt, extractMeaningfulPrompt } from '../prompt.js';

describe('prompt extraction', () => {
  it('extracts the real ask after Conductor system wrappers', () => {
    const prompt = extractMeaningfulPrompt(`
<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in /Users/virangjhaveri/conductor/workspaces/superdense/semarang.
</system_instruction>
<environment_context>
{"cwd":"/Users/virangjhaveri/conductor/workspaces/superdense/semarang"}
</environment_context>

can the claude code, codex, open code adapter figure out the plan mode enter and exit events from the session logs and then emit that to our internal system as well
`);

    expect(prompt).toBe('can the claude code, codex, open code adapter figure out the plan mode enter and exit events from the session logs and then emit that to our internal system as well');
  });

  it('uses command args when present', () => {
    expect(extractMeaningfulPrompt(`
<command-name>/superdense</command-name>
<command-message>superdense</command-message>
<command-args>Find my best coding session</command-args>
`)).toBe('Find my best coding session');
  });

  it('extracts Wand user requests from selection prompts', () => {
    expect(extractMeaningfulPrompt(`
The user selected a UI element in their running web app and requested a code change.

User request: make this title use the real session intent

Read these local files before editing:
- Selection context JSON: /tmp/context.json
`)).toBe('make this title use the real session intent');
  });

  it('rejects pure setup messages', () => {
    expect(extractMeaningfulPrompt('<system_instruction>internal setup</system_instruction>')).toBeUndefined();
    expect(extractMeaningfulPrompt('<environment_context>{"cwd":"/repo"}</environment_context>')).toBeUndefined();
    expect(extractMeaningfulPrompt('Respond directly to the user without extra narration.')).toBeUndefined();
  });

  it('rejects empty slash command sessions', () => {
    expect(extractMeaningfulPrompt(`
<command-name>/model</command-name>
<command-message>/model</command-message>
<command-args></command-args>
`)).toBeUndefined();
  });

  it('returns the first meaningful candidate', () => {
    expect(extractFirstMeaningfulPrompt([
      '<system_instruction>internal setup</system_instruction>',
      '   ',
      'Investigate title extraction',
    ])).toBe('Investigate title extraction');
  });
});
