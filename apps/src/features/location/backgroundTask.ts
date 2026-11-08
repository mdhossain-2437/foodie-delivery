import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { store } from '@/store/store';
import { deliveryApi } from '@/api/endpoints/deliveryApi';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

// Define the headless background task if supported on current platform
if (Platform.OS !== 'web' && typeof TaskManager.defineTask === 'function') {
    try {
        TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
            if (error) {
                console.error('[BackgroundTask] Error in location task:', error.message);
                return;
            }

            if (data) {
                const { locations } = data as { locations: Location.LocationObject[] };
                if (locations && locations.length > 0) {
                    const location = locations[0];
                    const { latitude, longitude } = location.coords;

                    try {
                        await store.dispatch(
                            deliveryApi.endpoints.locationPing.initiate({
                                latitude,
                                longitude,
                            })
                        );

                        console.log('[BackgroundTask] Successfully verified background ping:', latitude, longitude);
                    } catch (err) {
                        console.warn('[BackgroundTask] Ping failed in background:', err);
                    }
                }
            }
        });
    } catch (err) {
        console.warn('[BackgroundTask] Could not define background location task:', err);
    }
}

/**
 * Starts the background location tracking.
 */
export async function startBackgroundLocationTracking(): Promise<void> {
    if (Platform.OS === 'web') {
        return;
    }
    if (
        typeof Location.hasStartedLocationUpdatesAsync !== 'function' ||
        typeof Location.startLocationUpdatesAsync !== 'function' ||
        typeof TaskManager.isTaskDefined !== 'function'
    ) {
        return;
    }

    try {
        const isTaskDefined = TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK);
        if (!isTaskDefined) {
            console.warn('[BackgroundTask] Task is not defined');
            return;
        }

        const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        if (hasStarted) {
            return; // Already running
        }

        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 10,
            timeInterval: 15000,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
                notificationTitle: 'Delimo Delivery Partner is Active',
                notificationBody: 'Tracking your location to assign nearby orders',
                notificationColor: '#F59E0B',
            },
            pausesUpdatesAutomatically: false,
        });
    } catch (err) {
        console.warn('[BackgroundTask] Error starting background location tracking:', err);
    }
}

/**
 * Stops the background location tracking.
 */
export async function stopBackgroundLocationTracking(): Promise<void> {
    if (Platform.OS === 'web') {
        return;
    }
    if (
        typeof Location.hasStartedLocationUpdatesAsync !== 'function' ||
        typeof Location.stopLocationUpdatesAsync !== 'function'
    ) {
        return;
    }

    try {
        const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        if (hasStarted) {
            await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        }
    } catch (err) {
        console.warn('[BackgroundTask] Error stopping background location tracking:', err);
    }
}
