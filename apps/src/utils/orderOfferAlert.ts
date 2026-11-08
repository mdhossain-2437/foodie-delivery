import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';

let isAlerting = false;
let currentAlertOfferId: string | null = null;
let alertIntervalTimer: any = null;
let webAudioCtx: any = null;
let activeWebOscillators: any[] = [];
let nativeSoundObject: Audio.Sound | null = null;

// Initialize notification channel for Delivery Offers on Android
export async function initializeDeliveryOfferNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('delivery-offers', {
        name: 'New Order Offers',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 800, 400, 800, 400, 800],
        sound: 'default',
        lightColor: '#F59E0B',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
    } catch (e) {
      console.warn('[OfferAlert] Error setting up notification channel:', e);
    }
  }
}

/**
 * Synthesize a loud alert chime using Web Audio API on Web browsers.
 * Dual-tone attention-grabbing dispatch chime.
 */
function playWebAlertTone(): void {
  if (typeof window === 'undefined') return;

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    if (!webAudioCtx || webAudioCtx.state === 'closed') {
      webAudioCtx = new AudioCtx();
    }

    if (webAudioCtx.state === 'suspended') {
      void webAudioCtx.resume();
    }

    const now = webAudioCtx.currentTime;

    // Sequence of 3 loud, sharp tones: 880Hz, 1320Hz, 1760Hz
    const tones = [
      { freq: 880, start: 0.0, dur: 0.2 },
      { freq: 1320, start: 0.22, dur: 0.2 },
      { freq: 1760, start: 0.44, dur: 0.35 },
    ];

    tones.forEach(({ freq, start, dur }) => {
      const osc = webAudioCtx.createOscillator();
      const gain = webAudioCtx.createGain();

      // Sharp square/triangle blend for loud, penetrating acoustic projection
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + start);

      // Volume envelope with loud peak (0.9)
      gain.gain.setValueAtTime(0.001, now + start);
      gain.gain.linearRampToValueAtTime(0.85, now + start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);

      osc.connect(gain);
      gain.connect(webAudioCtx.destination);

      osc.start(now + start);
      osc.stop(now + start + dur);

      activeWebOscillators.push(osc);
      setTimeout(() => {
        const idx = activeWebOscillators.indexOf(osc);
        if (idx !== -1) activeWebOscillators.splice(idx, 1);
      }, (start + dur + 0.1) * 1000);
    });

    // Also trigger browser vibration if supported
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([600, 200, 600]);
    }
  } catch (err) {
    console.warn('[OfferAlert] Web audio play error:', err);
  }
}

/**
 * Configure native audio mode for maximum loudness and background playback.
 */
async function configureNativeAudioMode(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
  } catch (e) {
    console.warn('[OfferAlert] Audio mode configuration warning:', e);
  }
}

/**
 * Starts repeated loud sound and vibration for incoming delivery offers.
 * Continues running until stopOrderOfferAlert() is explicitly called.
 */
export async function startOrderOfferAlert(offerId: string, offerDetails?: { restaurantName?: string; orderNumber?: string }): Promise<void> {
  if (isAlerting && currentAlertOfferId === offerId) {
    // Already actively alerting for this offer
    return;
  }

  isAlerting = true;
  currentAlertOfferId = offerId;

  console.info(`[OfferAlert] Starting loud sound and vibration alert for offer: ${offerId}`);

  // 1. Initial Notification trigger (handles background/lockscreen alerts)
  try {
    await initializeDeliveryOfferNotificationChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🚨 NEW DELIVERY OFFER!',
        body: offerDetails?.restaurantName
          ? `Order #${offerDetails.orderNumber || ''} ready at ${offerDetails.restaurantName}. Tap to accept!`
          : 'A new order is ready for pickup near you. Tap to accept now!',
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0, 800, 400, 800, 400, 800],
        data: { channelId: 'delivery-offers', offerId },
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[OfferAlert] Could not schedule initial notification:', e);
  }

  // 2. Continuous device vibration (loops until cancelled)
  try {
    Vibration.vibrate([0, 800, 400, 800, 400, 800], true);
  } catch (e) {
    console.warn('[OfferAlert] Vibration error:', e);
  }

  // 3. Play immediate sound
  if (Platform.OS === 'web') {
    playWebAlertTone();
  } else {
    void configureNativeAudioMode();
    try {
      if (!nativeSoundObject) {
        const { sound } = await Audio.Sound.createAsync(require('../../assets/cycle_bell.wav'));
        nativeSoundObject = sound;
        await nativeSoundObject.setIsLoopingAsync(true);
      }
      await nativeSoundObject.stopAsync();
      await nativeSoundObject.playAsync();
    } catch (e) {
      console.warn('Native sound failed', e);
    }
  }

  // 4. Clear any previous alert loop timer
  if (alertIntervalTimer) {
    clearInterval(alertIntervalTimer);
    alertIntervalTimer = null;
  }

  // 5. Repeated sound + vibration pulse every 1.8 seconds
  alertIntervalTimer = setInterval(() => {
    if (!isAlerting) {
      if (alertIntervalTimer) {
        clearInterval(alertIntervalTimer);
        alertIntervalTimer = null;
      }
      return;
    }

    if (Platform.OS === 'web') {
      playWebAlertTone();
    } else {
      // Re-trigger vibration pulse on native if needed
      try {
        Vibration.vibrate([0, 800, 400, 800], false);
      } catch (e) {
        // ignore
      }
      if (nativeSoundObject) {
        // Now using loop natively, no need to re-trigger here.
      }
    }
  }, 1800);
}

/**
 * Immediately stops all alert sound, oscillator tones, repeating intervals, and vibration.
 */
export function stopOrderOfferAlert(): void {
  console.info('[OfferAlert] Stopping offer alert sound and vibration immediately');

  isAlerting = false;
  currentAlertOfferId = null;

  if (alertIntervalTimer) {
    clearInterval(alertIntervalTimer);
    alertIntervalTimer = null;
  }

  // Stop device vibration immediately
  try {
    Vibration.cancel();
  } catch (e) {
    // ignore
  }

  // Stop web browser vibration if active
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(0);
    } catch (e) {
      // ignore
    }
  }

  // Stop all active Web Audio oscillators
  try {
    activeWebOscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {
        // ignore
      }
    });
    activeWebOscillators = [];
  } catch (e) {
    // ignore
  }

  // Stop native sound if playing
  if (nativeSoundObject) {
    try {
      void nativeSoundObject.stopAsync();
      void nativeSoundObject.unloadAsync();
    } catch (e) {
      // ignore
    }
    nativeSoundObject = null;
  }

  // Dismiss any active system notifications
  try {
    void Notifications.dismissAllNotificationsAsync();
  } catch (e) {
    // ignore
  }
}

/**
 * Returns true if an offer alert is currently active.
 */
export function isOfferAlertActive(): boolean {
  return isAlerting;
}
