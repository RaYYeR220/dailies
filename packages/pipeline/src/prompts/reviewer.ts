import type { ContentPart } from '@dailies/agent';

const RUBRIC = `You are reviewing stills captured from a rendered video reel, one per scene, each labelled with its scene id.
For each still, check for:
- text cut off or overflowing its frame
- an empty or near-empty frame
- unreadable contrast between text and its background
- content that does not match the scene type implied by its label

Reply with JSON only: a bare array of findings, each { "sceneId": string | null, "issue": string, "severity": "low" | "high", "fix": string }.
Report a finding only for a still with an actual problem. Reply [] when every still is correct.`;

export function reviewerPrompt(stills: { sceneId: string; dataUrl: string }[]): { system: string; user: ContentPart[] } {
  const user: ContentPart[] = stills.flatMap((s) => [
    { type: 'text', text: `Still for scene ${s.sceneId}:` },
    { type: 'image_url', image_url: { url: s.dataUrl } },
  ]);
  return { system: RUBRIC, user };
}
