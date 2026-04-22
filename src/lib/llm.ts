import OpenAI from 'openai';
import { env } from '../env.js';

// We use the OpenAI SDK pointed at OpenRouter so we can swap models freely
// (Claude / GPT / Llama / Nemotron / Gemini) by changing one env var.
// OPENROUTER_MODEL defaults to a free model so the project boots without
// adding paid credits.
//
// Note: HTTP-Referer is optional and only used for OpenRouter's per-app
// analytics dashboard. We omit it so requests are not rejected by per-key
// allowlists. Set OPENROUTER_REFERER to enable.
export const llm = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    ...(process.env.OPENROUTER_REFERER ? { 'HTTP-Referer': process.env.OPENROUTER_REFERER } : {}),
    'X-Title': 'Logline AI',
  },
});

export type AnalyzedDialogue = {
  sequence: number;
  text: string;
  sceneCue?: string;
};

export type AnalyzedCharacter = {
  name: string;
  role: 'Lead' | 'Antagonist' | 'Supporting' | 'Cameo' | 'Narrator' | 'Comic relief' | string;
  gender: 'Male' | 'Female' | 'Unspecified';
  age: 'teen' | 'young' | 'middle-aged' | 'elder' | 'unspecified';
  mood: string;
  lineCount: number;
  dialogues: AnalyzedDialogue[];
};

export type AnalyzedEpisode = {
  episodeNumber: number;
  title?: string;
  characters: AnalyzedCharacter[];
};

export type ScriptAnalysis = {
  language: string;
  episodes: AnalyzedEpisode[];
};

const ANALYSIS_SYSTEM = `You are a professional script analyst for an audio drama production studio (Hoichoi).
You read raw script text - which may include Hindi/Bengali/English/Devanagari/Bangla mixed content - and produce a structured cast & dialogue breakdown for voice casting.

Your job:
1. Detect episode boundaries. Scripts may contain ONE episode or MULTIPLE episodes in a single document. Look for headers like "EPISODE 1", "EP 02", "Episode Two", "एपिसोड 1", "পর্ব ১", scene-1 reset markers, or clear narrative resets. If the whole document is one episode, return a single episode (episodeNumber=1).
2. For each episode, identify EVERY speaking character. Include narrators, voice-overs, divine voices/akashvani, and minor characters with even one line.
3. For each character produce:
   - name: as it appears in the script (preserve original capitalization, slashes for aliases like "Ravan / Dashanan")
   - role: classify as Lead, Antagonist, Supporting, Cameo, Narrator, or "Comic relief"
   - gender: "Male" / "Female" / "Unspecified" based on script context (pronouns, addressing, Devanagari gendered verbs)
   - age: "teen" / "young" / "middle-aged" / "elder" / "unspecified"
   - mood: one short evocative sentence describing voice tone needed (e.g. "Thunderous and commanding, with volcanic grief and quiet devotion to Mahadev"). This is shown to a voice director.
   - lineCount: exact integer count of their dialogue lines in this episode
   - dialogues: every single line of theirs in order, with sequence (1-indexed), text (original language preserved exactly), and optional sceneCue if there's a parenthetical/stage direction (e.g. "हँसते हुए", "(angrily)"). Do NOT summarise dialogues - include the full text verbatim.

Return ONLY valid JSON matching this exact schema. No prose, no markdown, no code fences:

{
  "language": "Hindi" | "Bengali" | "English" | "Tamil" | "Telugu" | "Marathi" | "Mixed",
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "optional title or null",
      "characters": [
        {
          "name": "string",
          "role": "Lead",
          "gender": "Male",
          "age": "middle-aged",
          "mood": "string",
          "lineCount": 113,
          "dialogues": [
            { "sequence": 1, "text": "...", "sceneCue": "..." }
          ]
        }
      ]
    }
  ]
}`;

/**
 * Send the full script text to the LLM and get back a structured analysis.
 * Free OpenRouter models (default: nvidia/nemotron-3-super-120b-a12b:free)
 * are usable but less reliable about JSON formatting than paid Claude / GPT.
 * The parser is defensive about stray code fences.
 */
export async function analyzeScript(rawText: string): Promise<ScriptAnalysis> {
  const response = await llm.chat.completions.create({
    model: env.OPENROUTER_MODEL,
    max_tokens: 16000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: ANALYSIS_SYSTEM },
      {
        role: 'user',
        content: `Analyze the following script. Return JSON only.\n\n<script>\n${rawText}\n</script>`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('LLM returned no content');
  return parseJson<ScriptAnalysis>(content);
}

export type VoiceCandidate = {
  voice_id: string;
  name: string;
  description?: string | null;
  labels?: Record<string, string> | null;
  language?: string | null;
  age?: string | null;
  gender?: string | null;
  use_case?: string | null;
  preview_url?: string | null;
};

const RANK_SYSTEM = `You are a voice director casting an audio drama. For one character, you are given:
- The character's name, role, age, gender, and mood
- A list of candidate voices from the ElevenLabs library (each with voice_id, name, labels/description)

Pick the THREE best voices (rank 0 = top pick, rank 1 = option 2, rank 2 = option 3).
Write a 1-2 sentence "reason" for each that a voice director would actually find useful - reference the voice's specific labels/descriptors and explain WHY it fits the character's mood and role. Be specific about what register or quality the voice brings (e.g. "modulation range fits a show that swings from battle to tenderness").

Return ONLY valid JSON, no prose, no code fences:

{
  "ranked": [
    { "voice_id": "...", "rank": 0, "reason": "..." },
    { "voice_id": "...", "rank": 1, "reason": "..." },
    { "voice_id": "...", "rank": 2, "reason": "..." }
  ]
}`;

export async function rankVoicesForCharacter(
  character: { name: string; role: string; gender: string; age: string; mood: string; language: string },
  candidates: VoiceCandidate[],
): Promise<{ voice_id: string; rank: number; reason: string }[]> {
  if (candidates.length === 0) return [];
  const trimmed = candidates.slice(0, 30).map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    description: v.description ?? null,
    labels: v.labels ?? null,
    language: v.language ?? null,
    age: v.age ?? null,
    gender: v.gender ?? null,
    use_case: v.use_case ?? null,
  }));

  const userMsg = `Character:
${JSON.stringify(character, null, 2)}

Candidates:
${JSON.stringify(trimmed, null, 2)}

Pick top 3.`;

  const response = await llm.chat.completions.create({
    model: env.OPENROUTER_MODEL,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: RANK_SYSTEM },
      { role: 'user', content: userMsg },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return [];
  const parsed = parseJson<{ ranked: { voice_id: string; rank: number; reason: string }[] }>(content);
  return parsed.ranked ?? [];
}

/**
 * Robust JSON extractor: free models occasionally wrap JSON in fences or
 * preface it with a sentence even when told not to. This peels both off.
 */
function parseJson<T>(text: string): T {
  let trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const firstBrace = trimmed.search(/[{[]/);
  if (firstBrace > 0) trimmed = trimmed.slice(firstBrace);
  return JSON.parse(trimmed) as T;
}
