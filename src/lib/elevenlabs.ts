import { env } from '../env.js';
import type { VoiceCandidate } from './llm.js';

const BASE = 'https://api.elevenlabs.io';

// ISO codes ElevenLabs uses in shared voice search
const LANGUAGE_TO_ISO: Record<string, string> = {
  Hindi: 'hi',
  Bengali: 'bn',
  English: 'en',
  Tamil: 'ta',
  Telugu: 'te',
  Marathi: 'mr',
  Punjabi: 'pa',
  Gujarati: 'gu',
  Urdu: 'ur',
};

// Map our age buckets to ElevenLabs age labels
const AGE_TO_EL: Record<string, string | undefined> = {
  teen: 'young',
  young: 'young',
  'middle-aged': 'middle_aged',
  middle_aged: 'middle_aged',
  elder: 'old',
  unspecified: undefined,
};

const GENDER_TO_EL: Record<string, string | undefined> = {
  Male: 'male',
  Female: 'female',
  Unspecified: undefined,
};

type SharedVoiceRaw = {
  voice_id: string;
  name: string;
  description?: string;
  labels?: Record<string, string>;
  language?: string;
  accent?: string;
  age?: string;
  gender?: string;
  use_case?: string;
  category?: string;
  preview_url?: string;
};

/**
 * Search the ElevenLabs Shared Voice Library. We pull a generous candidate
 * pool, then let Claude do the final taste-based ranking.
 */
export async function searchSharedVoices(opts: {
  language: string;
  gender?: string;
  age?: string;
  pageSize?: number;
}): Promise<VoiceCandidate[]> {
  const params = new URLSearchParams();
  const lang = LANGUAGE_TO_ISO[opts.language];
  if (lang) params.set('language', lang);
  const gender = opts.gender ? GENDER_TO_EL[opts.gender] : undefined;
  if (gender) params.set('gender', gender);
  const age = opts.age ? AGE_TO_EL[opts.age] : undefined;
  if (age) params.set('age', age);
  params.set('page_size', String(opts.pageSize ?? 30));

  const url = `${BASE}/v1/shared-voices?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs shared-voices ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { voices?: SharedVoiceRaw[] };
  const voices = data.voices ?? [];
  return voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    description: v.description ?? null,
    labels: v.labels ?? null,
    language: v.language ?? null,
    age: v.age ?? null,
    gender: v.gender ?? null,
    use_case: v.use_case ?? null,
    preview_url: v.preview_url ?? null,
  }));
}

export function isoLanguageLabel(language: string): string {
  return language;
}

export function ageLabelForVoice(v: VoiceCandidate): string {
  if (!v.age) return 'unspecified';
  if (v.age === 'middle_aged') return 'middle-aged';
  if (v.age === 'old') return 'elder';
  return v.age;
}

export function languageLabelForVoice(v: VoiceCandidate, fallback: string): string {
  if (!v.language) return fallback;
  // Reverse-map ISO back to friendly label, default to capitalized passthrough
  for (const [label, iso] of Object.entries(LANGUAGE_TO_ISO)) {
    if (iso === v.language) return label;
  }
  return fallback;
}
