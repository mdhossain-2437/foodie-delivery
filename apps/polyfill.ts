// Polyfill TextDecoder for Hermes
try {
  const NativeTextDecoder = (globalThis as any).TextDecoder;

  class PolyfilledTextDecoder {
    encoding: string;
    fatal: boolean;
    ignoreBOM: boolean;
    private nativeDecoder: any;

    constructor(label = 'utf-8', options?: { fatal?: boolean; ignoreBOM?: boolean }) {
      const normalized = String(label || 'utf-8').toLowerCase().replace(/[^a-z0-9]/g, '');
      this.fatal = !!options?.fatal;
      this.ignoreBOM = !!options?.ignoreBOM;

      if (!normalized || ['utf8', 'unicode11utf8', 'utf16le', 'utf16be'].includes(normalized)) {
        this.encoding = 'utf-8';
        if (typeof NativeTextDecoder === 'function') {
          try {
            this.nativeDecoder = new NativeTextDecoder(label, options);
          } catch {
            this.encoding = 'latin1';
          }
        }
      } else {
        this.encoding = normalized;
      }
    }

    decode(input?: ArrayBufferView | ArrayBuffer | null, options?: { stream?: boolean }): string {
      if (!input) return '';
      if (this.encoding !== 'utf-8' || !this.nativeDecoder) {
        const u8 =
          input instanceof Uint8Array
            ? input
            : new Uint8Array(ArrayBuffer.isView(input) ? input.buffer : input);
        let str = '';
        const chunkSize = 8192;
        for (let i = 0; i < u8.length; i += chunkSize) {
          str += String.fromCharCode.apply(
            null,
            u8.subarray(i, i + chunkSize) as unknown as number[]
          );
        }
        return str;
      }
      try {
        return this.nativeDecoder.decode(input, options);
      } catch {
        const u8 =
          input instanceof Uint8Array
            ? input
            : new Uint8Array(ArrayBuffer.isView(input) ? input.buffer : input);
        let str = '';
        for (let i = 0; i < u8.length; i += 8192) {
          str += String.fromCharCode.apply(null, u8.subarray(i, i + 8192) as unknown as number[]);
        }
        return str;
      }
    }
  }

  const targets = [
    typeof globalThis !== 'undefined' ? globalThis : null,
    typeof global !== 'undefined' ? global : null,
    typeof window !== 'undefined' ? window : null,
  ].filter(Boolean);

  for (const t of targets) {
    try {
      Object.defineProperty(t, 'TextDecoder', {
        value: PolyfilledTextDecoder,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      try {
        (t as any).TextDecoder = PolyfilledTextDecoder;
      } catch {}
    }
  }
} catch (e) {}

// Polyfill React Native feature flags for Expo Go VirtualizedList compatibility
try {
    const g = globalThis as any;
    if (!g.ReactNativeFeatureFlags) {
        g.ReactNativeFeatureFlags = {};
    }
    if (typeof g.ReactNativeFeatureFlags.enableOptimisedVirtualizedCells !== 'function') {
        g.ReactNativeFeatureFlags.enableOptimisedVirtualizedCells = () => false;
    }
} catch {
    // Ignore
}

try {
    // Metro bundler CJS/ESM interop requires patching the default export object directly
    const featureFlags = require('react-native/Libraries/ReactNative/ReactNativeFeatureFlags');
    if (featureFlags) {
        if (typeof featureFlags.enableOptimisedVirtualizedCells !== 'function') {
            featureFlags.enableOptimisedVirtualizedCells = () => false;
        }
        if (featureFlags.default && typeof featureFlags.default.enableOptimisedVirtualizedCells !== 'function') {
            featureFlags.default.enableOptimisedVirtualizedCells = () => false;
        }
    }
} catch (e) { }

try {
    // Expo Go sometimes relies on the internal private feature flags module
    const priv = require('react-native/src/private/featureflags/ReactNativeFeatureFlags');
    if (priv) {
        if (typeof priv.enableOptimisedVirtualizedCells !== 'function') {
            priv.enableOptimisedVirtualizedCells = () => false;
        }
        if (priv.default && typeof priv.default.enableOptimisedVirtualizedCells !== 'function') {
            priv.default.enableOptimisedVirtualizedCells = () => false;
        }
    }
} catch (e) { }

// Polyfill LocationEventEmitter.removeSubscription for Web expo-location compatibility
try {
    const locEmitterMod = require('expo-location/build/LocationEventEmitter');
    const emitter = locEmitterMod?.LocationEventEmitter || locEmitterMod?.default || locEmitterMod;
    if (emitter && typeof emitter.removeSubscription !== 'function') {
        emitter.removeSubscription = (subscription: any) => {
            try {
                if (subscription && typeof subscription.remove === 'function') {
                    subscription.remove();
                } else if (typeof emitter.removeListener === 'function' && subscription?.eventType && subscription?.listener) {
                    emitter.removeListener(subscription.eventType, subscription.listener);
                }
            } catch {}
        };
    }
} catch (e) { }
