import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

// Authentic Indian delivery partner alert text
const ALERT_TEXT = 'Dear delivery partner, your cash collection is high. Please deposit the cash to receive new orders.';

let lastSpokenAt = 0;
const THROTTLE_INTERVAL_MS = 30000; // speak at most once every 30 seconds

/**
 * Filter and find an Indian native English male voice.
 */
function findIndianMaleWebVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  // 1. Specific Indian male voices known on Windows, Android & Chrome
  const topIndianMaleNames = [
    'microsoft ravi',      // Windows Indian English Male
    'microsoft prabhat',   // Windows Hindi/Indian Male
    'google english (india)', // Chrome Android/Desktop
    'en-in-wavenet-b',     // Google Cloud TTS Indian Male
    'en-in-standard-b',    // Google Cloud TTS Indian Male
    'en-in-x-c-network',   // Android native Indian Male
    'en-in-x-d-network',   // Android native Indian Male
    'rishi',
  ];

  for (const name of topIndianMaleNames) {
    const match = voices.find(
      (v) =>
        (v.lang.toLowerCase().replace('_', '-').includes('en-in') ||
         v.lang.toLowerCase().replace('_', '-').includes('hi-in')) &&
        v.name.toLowerCase().includes(name)
    );
    if (match) return match;
  }

  // 2. Generic check: en-IN voice without female markers
  const femaleMarkers = ['heera', 'kalpana', 'neerja', 'female', 'woman', 'zira', 'susan', 'hazel', 'veena'];
  const indianEnVoices = voices.filter((v) => {
    const l = v.lang.toLowerCase().replace('_', '-');
    return l === 'en-in' || l.startsWith('en-in');
  });

  const maleIndian = indianEnVoices.find((v) => {
    const nameLower = v.name.toLowerCase();
    const isFemale = femaleMarkers.some((m) => nameLower.includes(m));
    return !isFemale;
  });

  if (maleIndian) return maleIndian;
  if (indianEnVoices.length > 0) return indianEnVoices[0];

  return null;
}

/**
 * Trigger AI male voice alert warning delivery partner that COD cash limit has been reached.
 * Uses native Indian English male voice on both Web Chrome and Mobile (Expo/APK).
 */
export async function playCashLimitVoiceAlert(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastSpokenAt < THROTTLE_INTERVAL_MS) {
    return;
  }
  lastSpokenAt = now;

  console.info('[VoiceAlert] Playing Indian Male COD Cash Limit Voice Alert:', ALERT_TEXT);

  // Web Chrome / Browser handling
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(ALERT_TEXT);
        utterance.rate = 0.90; // Natural steady pace
        utterance.pitch = 0.88; // Natural male baritone depth
        utterance.lang = 'en-IN'; // Force Indian English locale

        const voices = window.speechSynthesis.getVoices();
        const indianVoice = findIndianMaleWebVoice(voices);
        if (indianVoice) {
          utterance.voice = indianVoice;
        }

        window.speechSynthesis.speak(utterance);
        return;
      } catch (err) {
        console.warn('[VoiceAlert] Web SpeechSynthesis error, falling back to expo-speech:', err);
      }
    }
  }

  // Mobile App (Expo / APK) handling via expo-speech
  try {
    const isSpeaking = await Speech.isSpeakingAsync().catch(() => false);
    if (isSpeaking) {
      await Speech.stop();
    }

    let selectedVoiceId: string | undefined = undefined;
    try {
      const availableVoices = await Speech.getAvailableVoicesAsync();
      if (availableVoices && availableVoices.length > 0) {
        const femaleMarkers = ['heera', 'kalpana', 'neerja', 'female', 'woman'];
        const indianVoices = availableVoices.filter((v) => {
          const l = (v.language || '').toLowerCase().replace('_', '-');
          return l.includes('en-in') || l.includes('hi-in');
        });
        const maleVoice = indianVoices.find((v) => {
          const n = (v.name || v.identifier || '').toLowerCase();
          return !femaleMarkers.some((m) => n.includes(m));
        });
        if (maleVoice) {
          selectedVoiceId = maleVoice.identifier;
        } else if (indianVoices.length > 0) {
          selectedVoiceId = indianVoices[0].identifier;
        }
      }
    } catch {
      // Ignore voice query error, fallback to language tag
    }

    Speech.speak(ALERT_TEXT, {
      language: 'en-IN',
      voice: selectedVoiceId,
      pitch: 0.88, // Natural Indian male baritone pitch
      rate: 0.90,  // Clear, natural pronunciation
      onDone: () => {
        console.info('[VoiceAlert] Indian male voice alert completed.');
      },
      onError: (e) => {
        console.warn('[VoiceAlert] expo-speech error:', e);
      },
    });
  } catch (e) {
    console.warn('[VoiceAlert] Speech synthesis failed:', e);
  }
}

/**
 * Immediately stop any ongoing speech synthesis.
 */
export async function stopCashLimitVoiceAlert(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  try {
    await Speech.stop();
  } catch {
    // ignore
  }
}
