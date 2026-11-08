import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

const ALERT_TEXT = 'Dear delivery partner, your cash collected is high. Please deposit the cash to receive new orders.';

let lastSpokenAt = 0;
const THROTTLE_INTERVAL_MS = 30000; // speak at most once every 30 seconds

/**
 * Trigger AI male voice alert warning delivery partner that COD cash limit has been reached.
 */
export async function playCashLimitVoiceAlert(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastSpokenAt < THROTTLE_INTERVAL_MS) {
    return;
  }
  lastSpokenAt = now;

  console.info('[VoiceAlert] Playing COD Cash Limit Voice Alert:', ALERT_TEXT);

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(ALERT_TEXT);
        utterance.rate = 0.92;
        utterance.pitch = 0.85; // Male baritone pitch
        utterance.lang = 'en-IN';

        const voices = window.speechSynthesis.getVoices();
        // Look for male english voices
        const maleVoice = voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.toLowerCase().includes('male') ||
              v.name.toLowerCase().includes('david') ||
              v.name.toLowerCase().includes('george') ||
              v.name.toLowerCase().includes('guy') ||
              v.name.toLowerCase().includes('rishi') ||
              v.name.toLowerCase().includes('prabhat'))
        );

        if (maleVoice) {
          utterance.voice = maleVoice;
        }

        window.speechSynthesis.speak(utterance);
        return;
      } catch (err) {
        console.warn('[VoiceAlert] Web SpeechSynthesis error, falling back to expo-speech:', err);
      }
    }
  }

  try {
    const isSpeaking = await Speech.isSpeakingAsync().catch(() => false);
    if (isSpeaking) {
      await Speech.stop();
    }

    Speech.speak(ALERT_TEXT, {
      language: 'en-IN',
      pitch: 0.85, // Lower pitch for AI male resonance
      rate: 0.92,
      onDone: () => {
        console.info('[VoiceAlert] Voice alert completed.');
      },
      onError: (e) => {
        console.warn('[VoiceAlert] Speech error:', e);
      },
    });
  } catch (e) {
    console.warn('[VoiceAlert] expo-speech error:', e);
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
      } catch (e) {
        // ignore
      }
    }
  }

  try {
    await Speech.stop();
  } catch (e) {
    // ignore
  }
}

