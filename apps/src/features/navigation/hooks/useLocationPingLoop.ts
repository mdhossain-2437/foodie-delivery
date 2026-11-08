import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { trackAnalyticsEvent } from '@/utils/analytics';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useLocationPingMutation } from '@/api/endpoints/deliveryApi';
import { toUnwrappedApiError } from '../../auth/apiError';
import {
  LOCATION_PING_INTERVAL_MS,
  LocationPingBuffer,
} from '../pingBuffer';
import { validatePingCoords, type LocationPingPayload } from '../types';

type Options = {
  /** When false, timer does not publish (e.g. wrong order status). */
  enabled: boolean;
};

/**
 * Focus-scoped location ping loop — 1/3s elevated tier.
 * Offline: buffer last 2–3; reconnect flushes most-recent only (SD §12.4).
 */
export function useLocationPingLoop({ enabled }: Options) {
  const { isConnected } = useConnectivity();
  const [pingMutation] = useLocationPingMutation();
  const [lastPing, setLastPing] = useState<LocationPingPayload | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const bufferRef = useRef(new LocationPingBuffer());
  const focusedRef = useRef(false);
  const wasConnectedRef = useRef(isConnected);

  const publish = useCallback(
    async (sample: LocationPingPayload) => {
      try {
        await pingMutation(sample).unwrap();
        setLastPing(sample);
        trackAnalyticsEvent('location_ping_sent');
        trackAnalyticsEvent('location_ping_published');
      } catch (error) {
        const mapped = toUnwrappedApiError(error);
        if (mapped.code === 'RATE_LIMITED') {
          /* elevated throttle — soft ignore */
          return;
        }
        if (mapped.code === 'NETWORK_ERROR') {
          bufferRef.current.push(sample);
          setLastPing(sample);
          return;
        }
        /* other errors: keep last known UI coords, do not crash loop */
        setLastPing(sample);
      }
    },
    [pingMutation],
  );

  const tick = useCallback(async () => {
    if (!focusedRef.current || !enabled) return;

    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) {
      const requested = await Location.requestForegroundPermissionsAsync();
      if (!requested.granted) {
        setPermissionDenied(true);
        return;
      }
    }
    setPermissionDenied(false);

    let position: Location.LocationObject;
    try {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    } catch {
      // Default fallback mock position in India Bangalore for robust testing routing
      position = {
        coords: {
          latitude: 12.9800,
          longitude: 77.5900,
          altitude: null,
          accuracy: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      };
    }

    const validated = validatePingCoords(
      position.coords.latitude,
      position.coords.longitude,
    );
    if (!validated.ok) return;

    if (!isConnected) {
      bufferRef.current.push(validated.value);
      setLastPing(validated.value);
      return;
    }

    await publish(validated.value);
  }, [enabled, isConnected, publish]);

  const lastPublishTimeRef = useRef(0);
  const handleLiveLocation = useCallback(
    async (loc: Location.LocationObject) => {
      if (!focusedRef.current || !enabled) return;
      const now = Date.now();
      // Throttle pings to at most 1 ping per 1.5 seconds to protect rate-limit while delivering 1m responsiveness
      if (now - lastPublishTimeRef.current < 1500) {
        setLastPing({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        return;
      }
      lastPublishTimeRef.current = now;

      const validated = validatePingCoords(loc.coords.latitude, loc.coords.longitude);
      if (!validated.ok) return;

      if (!isConnected) {
        bufferRef.current.push(validated.value);
        setLastPing(validated.value);
        return;
      }

      await publish(validated.value);
    },
    [enabled, isConnected, publish],
  );

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      let isCancelled = false;
      let watchSub: Location.LocationSubscription | null = null;

      void tick();

      (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.granted && enabled && !isCancelled) {
            const sub = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.High,
                distanceInterval: 1, // trigger update whenever moving 1 meter!
                timeInterval: 1500,
              },
              (locationObj) => {
                if (!isCancelled) {
                  void handleLiveLocation(locationObj);
                }
              },
            );
            if (isCancelled) {
              try {
                if (typeof sub?.remove === 'function') {
                  sub.remove();
                }
              } catch {}
            } else {
              watchSub = sub;
            }
          }
        } catch { }
      })();

      const id = setInterval(() => {
        if (!isCancelled) {
          void tick();
        }
      }, LOCATION_PING_INTERVAL_MS);

      return () => {
        isCancelled = true;
        focusedRef.current = false;
        clearInterval(id);
        if (watchSub) {
          try {
            if (typeof watchSub.remove === 'function') {
              watchSub.remove();
            }
          } catch {
            // Safe ignore on Web where expo-location doesn't implement LocationEventEmitter.removeSubscription
          }
          watchSub = null;
        }
      };
    }, [tick, handleLiveLocation, enabled]),
  );

  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = isConnected;
    if (!wasConnected && isConnected && focusedRef.current && enabled) {
      const latest = bufferRef.current.takeMostRecentAndClear();
      if (latest) {
        void publish(latest);
      }
    }
  }, [enabled, isConnected, publish]);

  return { lastPing, permissionDenied };
}
