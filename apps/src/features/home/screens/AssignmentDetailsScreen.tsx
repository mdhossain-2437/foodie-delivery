import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View, StyleSheet, Pressable, SafeAreaView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as LinkingExpo from 'expo-linking';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Text } from '@/components/Text';
import { Toast } from '@/components/Toast';
import { trackAnalyticsEvent } from '@/utils/analytics';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useTheme } from '@/hooks/useTheme';
import { useGetOrderQuery } from '@/api/endpoints/ordersApi';
import { useGetNavigationDetailsQuery } from '@/api/endpoints/deliveryApi';
import { AssignmentDetailSkeleton } from '@/features/home/components/AssignmentDetailSkeleton';
import { useAssignmentOrderSubscription } from '@/features/home/hooks/useAssignmentOrderSubscription';
import { formatMoney, formatDistanceKm, isUuid } from '../types';
import { legForOrderStatus, calculateDistanceKm } from '@/features/navigation/types';
import { useLocationPingLoop } from '@/features/navigation/hooks/useLocationPingLoop';
import { BottomNav } from '@/navigation/BottomNav';
import type { MainStackParamList } from '@/navigation/types';
import { useAppSelector } from '@/store/hooks';
import { selectUserId } from '../../auth/authSlice';

type Props = NativeStackScreenProps<MainStackParamList, 'AssignmentDetails'>;

/**
 * P2-DEL-02/03 — GET /orders/{id} for assignment detail.
 * Premium Redesign - Swiggy/Zomato pattern.
 */
export function AssignmentDetailsScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { isConnected } = useConnectivity();
  const { orderId, assignmentId } = route.params;
  const validOrderId = Boolean(orderId && isUuid(orderId));
  const [toast, setToast] = useState<{
    message: string;
    variant: 'info' | 'success' | 'error' | 'warning';
  } | null>(null);

  const [reachedRestaurant, setReachedRestaurant] = useState(false);
  const [hasReachedCustomer, setHasReachedCustomer] = useState(false);
  const userId = useAppSelector(selectUserId);

  useEffect(() => {
    if (!assignmentId) return;
    const checkReached = async () => {
      try {
        const val = await AsyncStorage.getItem(`reached_customer_${assignmentId}`);
        if (val === 'true') {
          setHasReachedCustomer(true);
        }
      } catch {}
    };
    void checkReached();
  }, [assignmentId]);

  const orderQuery = useGetOrderQuery(orderId, {
    skip: !validOrderId,
    pollingInterval: 30_000,
    refetchOnFocus: true,
  });

  const { wsActive } = useAssignmentOrderSubscription(
    validOrderId ? orderId : undefined,
    orderQuery.data?.status,
  );

  const validAssignmentId = Boolean(assignmentId && typeof assignmentId === 'string' && assignmentId.length > 10);
  const navQuery = useGetNavigationDetailsQuery(assignmentId as string, {
    skip: !validAssignmentId,
  });

  const { lastPing } = useLocationPingLoop({
    enabled: validOrderId,
  });

  useEffect(() => {
    trackAnalyticsEvent('delivery_assignment_details_viewed');
    trackAnalyticsEvent('assignment_opened', {
      orderId,
      ...(assignmentId ? { assignmentId } : {}),
    });
  }, [assignmentId, orderId]);

  if (!validOrderId) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.color.background,
          padding: tokens.spacing.xl,
          justifyContent: 'center',
        }}
      >
        <EmptyState
          title="Invalid order link"
          description="Assignment details require a valid order id."
          accessibilityLabel="Invalid order id"
        />
      </View>
    );
  }

  const order = orderQuery.data;
  const loading = orderQuery.isLoading && !order;
  const status = order?.status;
  const leg = legForOrderStatus(status);

  const requireAssignmentId = () => {
    if (!assignmentId) {
      setToast({
        message: 'Assignment id is required for navigation. Accept an offer in this session.',
        variant: 'warning',
      });
      return false;
    }
    return true;
  };

  const isDropOffPhase = leg === 'drop';

  // Mocks provided if backend doesn't hydrate these fields yet
  const restaurantName = navQuery.data?.restaurantName ?? order?.restaurantName ?? 'Featured Restaurant';
  const restaurantAddress = navQuery.data?.restaurantAddress ?? order?.restaurantAddress ?? 'Pickup location pending...';
  const restaurantPhone = navQuery.data?.restaurantPhone ?? order?.restaurantPhone ?? '+918000000000';

  const customerName = navQuery.data?.customerName ?? order?.customerName ?? 'Customer';
  const deliveryAddress = navQuery.data?.deliveryAddress ?? order?.deliveryAddress ?? 'Customer delivery address pending...';
  const customerPhone = navQuery.data?.customerPhone ?? order?.customerPhone ?? '+919000000000';

  const defaultDistance = order?.estimatedDistance ?? 2.4;
  const liveTargetLat = isDropOffPhase ? navQuery.data?.deliveryLat : navQuery.data?.restaurantLat;
  const liveTargetLng = isDropOffPhase ? navQuery.data?.deliveryLng : navQuery.data?.restaurantLng;
  const distance = (lastPing && liveTargetLat && liveTargetLng)
    ? calculateDistanceKm(lastPing.latitude, lastPing.longitude, liveTargetLat, liveTargetLng)
    : defaultDistance;

  const isCod = (order as any)?.paymentMethod === 'COD' || (order as any)?.paymentMethod === 'CASH';

  const handleCall = (phone: string) => {
    LinkingExpo.openURL(`tel:${phone}`).catch(() =>
      setToast({ message: 'Unable to place a call.', variant: 'error' })
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.topArch, { height: 180 }]} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={orderQuery.isFetching}
            onRefresh={() => void orderQuery.refetch()}
            tintColor="#FFFFFF"
            colors={['#F59E0B']}
          />
        }
      >
        <View style={styles.headerBox}>
          <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={24} color="#FFF" />
          </Pressable>
          <View>
            <Text style={styles.pageTitle}>Order #{order?.orderNumber ?? '...'}</Text>
            <Text style={styles.pageSubtitle}>
              {wsActive ? '🟢 Live updates connected' : '🟡 Polling fallback active'}
            </Text>
          </View>
        </View>

        {!isConnected && (
          <View style={styles.warningContainer}>
            <Feather name="wifi-off" size={16} color="#B91C1C" />
            <Text style={styles.warningText}>Offline — showing cached order</Text>
          </View>
        )}

        {loading ? <AssignmentDetailSkeleton /> : null}

        {orderQuery.isError && !order ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Feather name="search" size={32} color="#A0AEC0" />
            </View>
            <Text style={styles.emptyTitle}>Order Not Found</Text>
            <Text style={styles.emptySubtitle}>Could not load this order. It may be unassigned or unavailable.</Text>
          </View>
        ) : null}

        {order ? (
          <>
            <View style={styles.statusPill}>
              <Text style={styles.statusText}>{order.status}</Text>
            </View>

            {/* Contextual Card: Restaurant in Pickup Phase, Customer in Drop Phase */}
            {!isDropOffPhase ? (
              <View style={styles.infoCard}>
                <View style={styles.infoRow}>
                  <View style={styles.iconCircle}>
                    <Ionicons name="restaurant" size={20} color="#F59E0B" />
                  </View>
                  <View style={styles.infoTextContainer}>
                    <Text style={styles.infoLabel}>Pickup From</Text>
                    <Text style={styles.infoTitle}>{restaurantName}</Text>
                    <Text style={styles.infoAddress} numberOfLines={2}>{restaurantAddress}</Text>
                    <View style={styles.distanceBadge}>
                      <Ionicons name="navigate-outline" size={12} color="#14532D" />
                      <Text style={styles.distanceText}>{formatDistanceKm(distance)} away</Text>
                    </View>
                  </View>
                  <Pressable style={styles.callButton} onPress={() => handleCall(restaurantPhone)}>
                    <Feather name="phone" size={20} color="#10B981" />
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.infoCard}>
                <View style={styles.infoRow}>
                  <View style={[styles.iconCircle, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
                    <Ionicons name="person" size={20} color="#10B981" />
                  </View>
                  <View style={styles.infoTextContainer}>
                    <Text style={styles.infoLabel}>Deliver To</Text>
                    <Text style={styles.infoTitle} numberOfLines={1}>{customerName}</Text>
                    <Text style={styles.infoAddress} numberOfLines={2}>{deliveryAddress}</Text>
                    <View style={styles.distanceBadge}>
                      <Ionicons name="navigate-outline" size={12} color="#14532D" />
                      <Text style={styles.distanceText}>{formatDistanceKm(distance)} away</Text>
                    </View>
                  </View>
                  <Pressable style={styles.callButton} onPress={() => handleCall(customerPhone)}>
                    <Feather name="phone" size={20} color="#10B981" />
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.orderCard}>
              <View style={styles.orderHeader}>
                <Text style={styles.itemsLabel}>Order Items</Text>
                <View style={styles.totalBadge}>
                  <Text style={styles.totalAmount}>Delivery Package</Text>
                </View>
              </View>

              <View style={styles.divider} />
              {(order.items ?? []).map((item: any, index: number) => (
                <View key={`${item.menuItemId ?? 'item'}-${index}`} style={styles.itemRow}>
                  <View style={styles.itemQuantityCircle}>
                    <Text style={styles.itemQuantityText}>{item.quantity}x</Text>
                  </View>
                  <Text style={styles.itemName}>{item.name ?? 'Unknown Item'}</Text>
                </View>
              ))}
            </View>

            <View style={styles.actionSection}>
              <Pressable
                style={[
                  styles.primaryNavButton,
                  isDropOffPhase && hasReachedCustomer && { backgroundColor: '#059669' },
                ]}
                onPress={() => {
                  trackAnalyticsEvent('start_navigation_tapped', { orderId });
                  if (!requireAssignmentId() || !assignmentId) return;
                  if (isDropOffPhase) {
                    navigation.navigate('CustomerDelivery' as any, {
                      assignmentId,
                      orderId,
                    } as any);
                  } else {
                    navigation.navigate('DeliveryNavigation', {
                      assignmentId,
                      orderId,
                      leg,
                    });
                  }
                }}
              >
                <Feather
                  name={isDropOffPhase && hasReachedCustomer ? 'map-pin' : 'navigation'}
                  size={20}
                  color="#FFFFFF"
                  style={styles.actionIcon}
                />
                <Text style={styles.actionButtonText}>
                  {isDropOffPhase
                    ? hasReachedCustomer
                      ? 'At Customer Location (Complete Delivery)'
                      : 'Navigate to Customer'
                    : 'Navigate to Restaurant'}
                </Text>
              </Pressable>

              {/* Show status badge only if payment is already collected or prepaid */}
              {isDropOffPhase && isCod && ((order as any)?.paymentStatus === 'CAPTURED' || (order as any)?.paymentStatus === 'PAID') && (
                <View style={[styles.primaryNavButton, { backgroundColor: '#10B981', marginTop: 12 }]}>
                  <Feather name="check-circle" size={20} color="#FFF" style={styles.actionIcon} />
                  <Text style={styles.actionButtonText}>Payment Collected ✓</Text>
                </View>
              )}
            </View>
          </>
        ) : null}

      </ScrollView>

      <Toast
        visible={Boolean(toast)}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        accessibilityLabel={toast?.message ?? 'Toast'}
        onDismiss={() => setToast(null)}
      />

      <BottomNav />
    </SafeAreaView>
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
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 60,
  },
  headerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  pageSubtitle: {
    fontSize: 13,
    color: '#A0AEC0',
    fontWeight: '500',
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  statusText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1,
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoTextContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  infoLabel: {
    fontSize: 12,
    color: '#A0AEC0',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  infoTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1A202C',
    marginBottom: 2,
  },
  infoAddress: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 6,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  distanceText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#14532D',
    marginLeft: 4,
  },
  callButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F0FDF4',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  itemsLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A202C',
  },
  totalBadge: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#14532D',
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginBottom: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemQuantityCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  itemQuantityText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFF',
  },
  itemName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3748',
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4A5568',
  },
  actionSection: {
    gap: 16,
  },
  primaryNavButton: {
    flexDirection: 'row',
    backgroundColor: '#14532D',
    borderRadius: 20,
    height: 64,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#14532D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  actionIcon: {
    marginRight: 8,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
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
  warningContainer: {
    backgroundColor: '#FEF2F2',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    marginBottom: 16,
  },
  warningText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    marginTop: 20,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A202C',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#718096',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});

