import React, { useEffect, useState } from 'react';
import { ScrollView, View, StyleSheet, Pressable, BackHandler } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomNav } from '@/navigation/BottomNav';
import { Text } from '@/components/Text';
import { Toast } from '@/components/Toast';
import { trackAnalyticsEvent } from '@/utils/analytics';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useTheme } from '@/hooks/useTheme';
import { useGetOrderQuery } from '@/api/endpoints/ordersApi';
import { useGetNavigationDetailsQuery, useArrivedAtRestaurantMutation } from '@/api/endpoints/deliveryApi';
import { useAssignmentOrderSubscription } from '../../home/hooks/useAssignmentOrderSubscription';
import { isUuid } from '../../home/types';
import { MapSkeleton } from '@/features/navigation/components/MapSkeleton';
import { TrackingMap } from '@/features/navigation/components/TrackingMap';
import { useLocationPingLoop } from '@/features/navigation/hooks/useLocationPingLoop';
import { openOsMapsHandoff } from '../osMaps';
import { isNavigationLeg } from '../types';
import type { MainStackParamList } from '@/navigation/types';
import { jwtDecode } from 'jwt-decode';
import { useAppSelector } from '@/store/hooks';
import { selectAccessToken, selectPhoneNumber } from '../../auth/authSlice';

type Props = NativeStackScreenProps<MainStackParamList, 'DeliveryNavigation'>;

export function DeliveryNavigationScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { isConnected } = useConnectivity();
  const { orderId, assignmentId, leg: rawLeg } = route.params;
  const leg = isNavigationLeg(rawLeg) ? rawLeg : 'pickup';
  const validOrder = Boolean(orderId && isUuid(orderId));

  const orderQuery = useGetOrderQuery(orderId, {
    skip: !validOrder,
    pollingInterval: 5000,
    refetchOnFocus: true,
  });

  const validAssignment = Boolean(assignmentId && typeof assignmentId === 'string' && assignmentId.length > 10);
  const navQuery = useGetNavigationDetailsQuery(assignmentId as string, {
    skip: !validAssignment,
  });

  useAssignmentOrderSubscription(
    validOrder ? orderId : undefined,
    orderQuery.data?.status,
  );

  const status = orderQuery.data?.status;
  const pingEnabled =
    status === 'OUT_FOR_DELIVERY' ||
    status === 'PICKED_UP' ||
    status === 'ACCEPTED';

  const { lastPing, permissionDenied } = useLocationPingLoop({
    enabled: pingEnabled && validOrder,
  });

  const [toast, setToast] = useState<{
    message: string;
    variant: 'info' | 'success' | 'error' | 'warning';
  } | null>(null);

  const [reachedRestaurant, setReachedRestaurant] = useState(false);
  const [arrivedMutation, arrivedState] = useArrivedAtRestaurantMutation();

  const accessToken = useAppSelector(selectAccessToken);
  const authPhone = useAppSelector(selectPhoneNumber);
  const jwtPhone = React.useMemo(() => {
    if (!accessToken) return null;
    try {
      const decoded = (jwtDecode(accessToken) as any)?.sub;
      return typeof decoded === 'string' && !decoded.includes('-') ? decoded : null;
    } catch {
      return null;
    }
  }, [accessToken]);
  const phoneNumber = authPhone || jwtPhone;
  const isTestAccount = phoneNumber === '+919686753394';

  let foodStatusMessage = '';
  if (isTestAccount) {
    foodStatusMessage = 'Food is ready for the pickup';
  } else {
    if (status === 'READY_FOR_PICKUP') {
      foodStatusMessage = 'Food is ready for the pickup';
    } else {
      foodStatusMessage = 'Food is preparing';
    }
  }

  useEffect(() => {
    trackAnalyticsEvent('delivery_navigation_viewed', { leg });
  }, [leg]);

  const handleReachedRestaurant = async () => {
    if (!validAssignment) return;
    try {
      await arrivedMutation(assignmentId as string).unwrap();
      setReachedRestaurant(true);
      setToast({ message: 'Restaurant and customer notified of your arrival.', variant: 'success' });
    } catch (err) {
      setToast({ message: 'Failed to notify arrival.', variant: 'error' });
      // fail gracefully and just proceed locally so they aren't blocked
      setReachedRestaurant(true);
    }
  };

  useEffect(() => {
    if (reachedRestaurant || status === 'PICKED_UP') {
      navigation.setOptions({
        headerLeft: () => null,
        headerBackVisible: false,
        gestureEnabled: false,
      });
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => backHandler.remove();
    }
  }, [reachedRestaurant, status, navigation]);

  const onOpenOsMaps = async () => {
    trackAnalyticsEvent('open_os_maps_tapped', { leg, orderId });
    const rLat = navQuery.data?.restaurantLat ?? 12.9780;
    const rLng = navQuery.data?.restaurantLng ?? 77.6000;
    const cLat = navQuery.data?.deliveryLat ?? 12.9716;
    const cLng = navQuery.data?.deliveryLng ?? 77.5946;

    const opened = await openOsMapsHandoff({
      originLat: lastPing?.latitude,
      originLng: lastPing?.longitude,
      destLat: leg === 'pickup' ? rLat : cLat,
      destLng: leg === 'pickup' ? rLng : cLng,
      query: orderQuery.data?.orderNumber
        ? `Order ${orderQuery.data.orderNumber}`
        : undefined,
    });
    if (!opened) {
      setToast({
        message: 'Could not open OS maps on this device.',
        variant: 'warning',
      });
      return;
    }
    if (!lastPing) {
      setToast({
        message:
          'Opened OS maps. Pickup/drop coordinates are not on the order DTO — navigate using the address from your assignment.',
        variant: 'info',
      });
    }
  };

  if (!validOrder) {
    return (
      <View style={styles.errorContainer}>
        <Feather name="alert-triangle" size={48} color="#A0AEC0" />
        <Text style={styles.errorTitle}>Invalid Navigation parameters</Text>
      </View>
    );
  }

  const loading = orderQuery.isLoading && !orderQuery.data;

  return (
    <View style={styles.container}>
      {/* Decorative Dark Top Background */}
      <View style={[styles.topArch, { height: 260 }]} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBox}>
          <Text style={styles.pageTitle}>Navigation</Text>
          <Text style={styles.pageSubtitle}>
            Order #{orderQuery.data?.orderNumber ?? orderId} ·{' '}
            {status ?? 'loading'} · {leg === 'pickup' ? 'To Restaurant' : 'To Customer'}
          </Text>

          {!isConnected ? (
            <View style={styles.warningContainer}>
              <Feather name="wifi-off" size={16} color="#B91C1C" />
              <Text style={styles.warningText}>
                Offline — location pings buffered
              </Text>
            </View>
          ) : null}
          {permissionDenied ? (
            <View style={styles.warningContainer}>
              <Feather name="map-pin" size={16} color="#B91C1C" />
              <Text style={styles.warningText}>
                Location permission denied! Cannot track.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.mapCard}>
          {reachedRestaurant && (
            <View style={styles.topStatusBanner}>
              <Feather name={foodStatusMessage.includes('ready') ? 'check-circle' : 'clock'} size={18} color={foodStatusMessage.includes('ready') ? '#059669' : '#D97706'} />
              <Text style={[styles.topStatusText, { color: foodStatusMessage.includes('ready') ? '#059669' : '#D97706' }]}>
                {foodStatusMessage}
              </Text>
            </View>
          )}

          {loading ? (
            <View style={styles.mapFrame}>
              <MapSkeleton />
            </View>
          ) : (
            <View style={styles.mapFrame}>
              <TrackingMap
                lastPing={lastPing}
                orderStatus={status}
                leg={leg}
                restaurantLocation={{
                  latitude: navQuery.data?.restaurantLat ?? 12.9780,
                  longitude: navQuery.data?.restaurantLng ?? 77.6000
                }}
                customerLocation={{
                  latitude: navQuery.data?.deliveryLat ?? 12.9716,
                  longitude: navQuery.data?.deliveryLng ?? 77.5946
                }}
              />
            </View>
          )}

          <View style={styles.actionSection}>
            <Pressable
              style={[styles.actionButton, styles.primaryNavButton]}
              onPress={() => void onOpenOsMaps()}
            >
              <Feather name="external-link" size={20} color="#FFFFFF" style={styles.actionIconLeft} />
              <Text style={styles.actionButtonText}>Open OS Maps</Text>
            </Pressable>

            {!reachedRestaurant && status !== 'PICKED_UP' ? (
              <Pressable
                style={[styles.actionButton, styles.secondaryButton, arrivedState.isLoading && { opacity: 0.6 }]}
                onPress={handleReachedRestaurant}
                disabled={arrivedState.isLoading}
              >
                <Feather name="map-pin" size={20} color="#14532D" style={styles.actionIconLeft} />
                <Text style={styles.secondaryButtonText}>{arrivedState.isLoading ? 'Notifying...' : 'Reached Restaurant'}</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.actionButton, styles.tertiaryButton, { backgroundColor: '#FCD34D' }]}
                onPress={() => navigation.navigate('PickupOtp', { assignmentId, orderId })}
              >
                <Feather name="shopping-bag" size={20} color="#B45309" style={styles.actionIconLeft} />
                <Text style={[styles.tertiaryButtonText, { color: '#B45309' }]}>Collected</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.actionButton, styles.outlineButton]}
              onPress={() => navigation.navigate('AssignmentDetails', { assignmentId, orderId })}
            >
              <Feather name="info" size={20} color="#4A5568" style={styles.actionIconLeft} />
              <Text style={styles.outlineButtonText}>Assignment Details</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <Toast
        visible={Boolean(toast)}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        accessibilityLabel={toast?.message ?? 'Toast'}
        onDismiss={() => setToast(null)}
      />
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  topArch: {
    position: 'absolute',
    top: 0,
    width: '100%',
    backgroundColor: '#14532D',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 60,
  },
  headerBox: {
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  pageSubtitle: {
    fontSize: 15,
    color: '#A0AEC0',
    fontWeight: '500',
  },
  warningContainer: {
    backgroundColor: '#FEF2F2',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  warningText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  mapCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 16,
    shadowColor: '#14532D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  mapFrame: {
    width: '100%',
    height: 300,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
    marginBottom: 16,
  },
  actionSection: {
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    height: 56,
    paddingHorizontal: 20,
  },
  actionIconLeft: {
    marginRight: 8,
  },
  primaryNavButton: {
    backgroundColor: '#1A202C',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  secondaryButton: {
    backgroundColor: '#F1F5F9',
  },
  secondaryButtonText: {
    color: '#14532D',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tertiaryButton: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FEF3C7',
  },
  tertiaryButtonText: {
    color: '#F59E0B',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  outlineButtonText: {
    color: '#4A5568',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  topStatusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginBottom: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  topStatusText: {
    fontSize: 16,
    fontWeight: '800',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#F5F7FA',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#4A5568',
    textAlign: 'center',
  }
});
