// services/aiConsent.ts
// Guideline 5.1.1(i) / 5.1.2(i): the app sends league and roster data to a
// third-party AI service, so it must disclose WHAT is sent and TO WHOM, and
// obtain permission BEFORE sending. Apple rejected 1.0 (build 195) because
// none of that existed in-app — a privacy policy alone is explicitly not
// sufficient. Consent is stored per device (AsyncStorage); a reinstall clears
// it, which fails safe — the user is simply asked again before anything is sent.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'ai_data_consent_v1';

export type AIConsent = 'granted' | 'declined' | null;

export async function getAIConsent(): Promise<AIConsent> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === 'granted' || v === 'declined' ? v : null;
  } catch {
    return null;
  }
}

export async function setAIConsent(value: 'granted' | 'declined'): Promise<void> {
  try { await AsyncStorage.setItem(KEY, value); } catch {}
}

export async function hasAIConsent(): Promise<boolean> {
  return (await getAIConsent()) === 'granted';
}

// What we tell the user, kept here so the consent screen, the settings row and
// the App Review notes can't drift apart.
export const AI_DISCLOSURE = {
  recipient: 'Anthropic (Claude)',
  sent: [
    'The questions you type into the AI Coach, Trade Analyzer and Draft Copilot',
    'Your league settings — scoring format, roster slots, league size',
    'Rosters, team names and standings from your league — yours and the other teams\u2019',
    'Screenshots you choose to share with AI features like the Trade Analyzer or the Coach\u2019s draft-board reader',
    'On Pro, a summary of your past coaching conversations, so advice stays consistent',
    'Public NFL player data such as stats, injury status and depth-chart position',
  ],
  notSent: [
    'Your name, email address or password',
    'Your payment information',
    'Your contacts or location data',
  ],
} as const;
