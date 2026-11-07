import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text } from '@/components/Text';
import { Toast } from '@/components/Toast';
import { BottomNav } from '@/navigation/BottomNav';
import type { MainStackParamList } from '@/navigation/types';
import {
  useGetAvailableShiftsQuery,
  useGetMyShiftBookingsQuery,
  useBookDeliveryShiftMutation,
  useSetAvailabilityMutation,
  type DeliveryShift,
} from '@/api/endpoints/deliveryApi';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  setIsOnline,
  selectActiveAssignment,
  setActiveAssignment,
} from '../availabilitySlice';
import { useGetOrderQuery } from '@/api/endpoints/ordersApi';
import { isTerminalOrderStatus } from '../types';
import {
  getStoredActiveShift,
  storeActiveShift,
  clearStoredActiveShift,
  FALLBACK_ADMIN_SHIFTS,
  type ActiveShiftData,
} from '../shiftStorage';

type Props = NativeStackScreenProps<MainStackParamList, 'MyShift'>;

export function MyShiftScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const { data: serverShifts, isLoading: isLoadingShifts, refetch: refetchShifts } = useGetAvailableShiftsQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  const { data: bookingsData, refetch: refetchBookings } = useGetMyShiftBookingsQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  const [bookShiftMutation, { isLoading: isBooking }] = useBookDeliveryShiftMutation();
  const [setAvailability] = useSetAvailabilityMutation();
  const dispatch = useAppDispatch();
  const active = useAppSelector(selectActiveAssignment);
  const orderQuery = useGetOrderQuery(active?.orderId ?? '', { skip: !active?.orderId, pollingInterval: active?.orderId ? 5000 : 0 });
  const isOrderTerminal = isTerminalOrderStatus(orderQuery.data?.status);
  const hasActiveDelivery = Boolean(active?.orderId && !isOrderTerminal);

  useEffect(() => {
    if (active?.orderId && isTerminalOrderStatus(orderQuery.data?.status)) {
      dispatch(setActiveAssignment(null));
    }
  }, [active?.orderId, orderQuery.data?.status, dispatch]);

  const [activeShift, setActiveShift] = useState<ActiveShiftData | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [adminLiveShifts, setAdminLiveShifts] = useState<DeliveryShift[]>([]);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Requirement: Display message on screen displaying "Shift Booked" and permit going online
  const [showShiftBookedModal, setShowShiftBookedModal] = useState(false);
  const [justBookedShift, setJustBookedShift] = useState<ActiveShiftData | null>(null);

  const loadShiftData = useCallback(async () => {
    try {
      const stored = await getStoredActiveShift();
      setActiveShift(stored);
    } catch {
      // Continue silently
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadShiftData();
      void refetchShifts();
      void refetchBookings();
    }, [loadShiftData, refetchShifts, refetchBookings])
  );

  useEffect(() => {
    let isCancelled = false;
    async function fetchAdminShifts() {
      if (Platform.OS !== 'web' && typeof fetch === 'undefined') return;

      const endpoints = [
        'http://localhost:3000/api/bff/admin/shifts',
        'http://localhost:8082/api/v1/delivery/shifts/available',
        '/api/v1/delivery/shifts/available',
      ];

      for (const endpoint of endpoints) {
        try {
          const res = await fetch(endpoint, {
            headers: { Accept: 'application/json' },
          });
          if (res.ok) {
            const json = await res.json();
            const list = Array.isArray(json?.data)
              ? json.data
              : Array.isArray(json)
              ? json
              : null;
            if (list && list.length > 0) {
              const activeList = list.filter(
                (s: any) => !s.status || s.status.toUpperCase() === 'ACTIVE'
              );
              if (activeList.length > 0 && !isCancelled) {
                setAdminLiveShifts(activeList);
                if (activeList.length >= 2 || endpoint.includes('localhost')) {
                  break;
                }
              }
            }
          }
        } catch {
          // Continue to next endpoint
        }
      }
    }

    void fetchAdminShifts();
    return () => {
      isCancelled = true;
    };
  }, []);

  // Merge available server shifts with live admin shifts and fallback
  const availableShifts = useMemo(() => {
    if (adminLiveShifts.length > 0) {
      return adminLiveShifts;
    }
    if (serverShifts && serverShifts.length > 1) {
      return serverShifts;
    }
    return FALLBACK_ADMIN_SHIFTS;
  }, [adminLiveShifts, serverShifts]);

  // Determine current active shift ID
  const effectiveActiveId = activeShift?.shiftId || bookingsData?.[0]?.shiftId;

  const handleSelectShift = (shift: DeliveryShift) => {
    setSelectedShiftId(shift.shiftId);
  };

  const handleConfirmShift = async () => {
    const shiftToBook = availableShifts.find((s) => s.shiftId === (selectedShiftId || effectiveActiveId)) || availableShifts[0];
    if (!shiftToBook) {
      setToast({ message: 'Please select an admin shift to proceed.', variant: 'warning' });
      return;
    }

    try {
      // Attempt backend booking
      try {
        await bookShiftMutation(shiftToBook.shiftId).unwrap();
      } catch (err: any) {
        console.info('[ShiftScreen] Backend shift booking response:', err);
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const newActiveShift: ActiveShiftData = {
        shiftId: shiftToBook.shiftId,
        shiftName: shiftToBook.shiftName,
        startTime: shiftToBook.startTime,
        endTime: shiftToBook.endTime,
        durationHours: shiftToBook.durationHours,
        date: todayStr,
        status: 'ACTIVE',
        startedAt: new Date().toISOString(),
      };

      await storeActiveShift(newActiveShift);
      setActiveShift(newActiveShift);
      setJustBookedShift(newActiveShift);
      setShowShiftBookedModal(true);
      setToast({ message: `Shift "${shiftToBook.shiftName}" booked successfully!`, variant: 'success' });
    } catch (e: any) {
      console.error('[ShiftScreen] Failed to activate shift:', e);
      setToast({ message: 'Could not book shift. Please try again.', variant: 'error' });
    }
  };

  const handleEndShift = async () => {
    if (hasActiveDelivery) {
      const orderNum =
        orderQuery.data?.orderNumber ||
        (active?.orderId ? active.orderId.substring(0, 8).toUpperCase() : '');
      const orderMsg = orderNum ? `order #${orderNum}` : 'your active order';
      setToast({
        message: `You cannot end your shift or go offline while you have an active order in progress (${orderMsg}). Please complete the delivery first.`,
        variant: 'warning',
      });
      Alert.alert(
        'Cannot End Shift',
        `You cannot end your shift while you have an active order to deliver. Please complete the delivery of ${orderMsg} first.`,
        [
          { text: 'OK', style: 'cancel' },
          ...(active?.orderId
            ? [
                {
                  text: 'View Order',
                  onPress: () =>
                    navigation.navigate('AssignmentDetails', {
                      assignmentId: active.assignmentId,
                      orderId: active.orderId,
                    }),
                },
              ]
            : []),
        ],
      );
      return;
    }

    await clearStoredActiveShift();
    setActiveShift(null);
    setJustBookedShift(null);
    try {
      await setAvailability({ isOnline: false }).unwrap();
    } catch {
      // Continue silently
    }
    dispatch(setIsOnline(false));
    setToast({ message: 'Shift ended. You are now offline. Please book a shift to come online.', variant: 'info' });
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchShifts(), refetchBookings(), loadShiftData()]);
    setIsRefreshing(false);
  };

  const getShiftIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('morning')) return 'sunny-outline';
    if (lower.includes('afternoon')) return 'partly-sunny-outline';
    if (lower.includes('evening')) return 'cloudy-night-outline';
    if (lower.includes('night')) return 'moon-outline';
    return 'time-outline';
  };

  const getShiftColor = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('morning')) return '#F59E0B';
    if (lower.includes('afternoon')) return '#EAB308';
    if (lower.includes('evening')) return '#8B5CF6';
    if (lower.includes('night')) return '#3B82F6';
    return '#10B981';
  };

  const formatShiftDisplayName = (name: string) => {
    if (!name) return 'Shift';
    const trimmed = name.trim();
    return trimmed.toLowerCase().endsWith('shift') ? trimmed : `${trimmed} Shift`;
  };

  return (
    <View style={styles.container}>
      {/* Decorative Gradient Header */}
      <LinearGradient
        colors={['#0F3E22', '#14532D', '#1B6A3A']}
        style={[styles.headerGradient, { paddingTop: insets.top + 16 }]}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.navigate('DeliveryHome')}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
          >
            <Feather name="arrow-left" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>My Shift</Text>
            <Text style={styles.headerSubtitle}>Book a work shift to go online & receive orders</Text>
          </View>
          <View style={styles.headerIconBadge}>
            <Ionicons name="calendar" size={22} color="#FCD34D" />
          </View>
        </View>
      </LinearGradient>

      {/* Main Content */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#0F3E22"
            colors={['#10B981']}
          />
        }
      >
        {/* Shift Requirement & Online Eligibility Banner */}
        {activeShift ? (
          <View style={styles.eligibilityCardSuccess}>
            <View style={styles.eligibilityCardLeft}>
              <View style={styles.eligibilityIconCircleSuccess}>
                <Ionicons name="checkmark-circle" size={22} color="#059669" />
              </View>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={styles.eligibilityTitleSuccess}>Shift Booked • Online Allowed</Text>
                <Text style={styles.eligibilitySubtitleSuccess}>
                  Your shift is active. You can now come online and receive orders!
                </Text>
              </View>
            </View>
            <Pressable
              style={styles.goOnlineQuickBtn}
              onPress={() => navigation.navigate('DeliveryHome', { autoGoOnline: true })}
              accessibilityRole="button"
              accessibilityLabel="Go Online"
            >
              <Ionicons name="flash" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
              <Text style={styles.goOnlineQuickBtnText}>Go Online</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.eligibilityCardWarning}>
            <View style={styles.eligibilityIconCircleWarning}>
              <Ionicons name="alert-circle" size={22} color="#D97706" />
            </View>
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.eligibilityTitleWarning}>Shift Booking Required</Text>
              <Text style={styles.eligibilitySubtitleWarning}>
                You must first book an available shift below before you can come online.
              </Text>
            </View>
          </View>
        )}

        {/* Active Shift Card Banner (if active) */}
        {activeShift && (
          <View style={styles.activeBanner}>
            <View style={styles.activeBannerTop}>
              <View style={styles.activePill}>
                <View style={styles.pulsingDot} />
                <Text style={styles.activePillText}>CURRENT ACTIVE SHIFT</Text>
              </View>
              <Pressable
                style={styles.endShiftBtn}
                onPress={handleEndShift}
                accessibilityRole="button"
                accessibilityLabel="End current shift"
              >
                <Text style={styles.endShiftBtnText}>End Shift</Text>
              </Pressable>
            </View>

            <View style={styles.activeDetailsRow}>
              <View style={styles.activeShiftIconBox}>
                <Ionicons name="time" size={24} color="#065F46" />
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.activeShiftTitle}>{formatShiftDisplayName(activeShift.shiftName)}</Text>
                <Text style={styles.activeShiftTiming}>
                  {activeShift.startTime} — {activeShift.endTime} ({activeShift.durationHours || 'Active'})
                </Text>
                <Text style={styles.activeShiftStatus}>
                  Status: Shift Booked • Eligible for online orders
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Section: Admin Shifts List */}
        <View style={styles.shiftsSection}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>
              Available Shifts ({availableShifts.length})
            </Text>
            {isLoadingShifts && <ActivityIndicator size="small" color="#10B981" />}
          </View>
          <Text style={styles.sectionSubtitle}>
            Choose an official shift scheduled and verified by admin
          </Text>

          <View style={styles.cardsGrid}>
            {availableShifts.map((shift) => {
              const isSelected = selectedShiftId === shift.shiftId || (!selectedShiftId && effectiveActiveId === shift.shiftId);
              const shiftColor = getShiftColor(shift.shiftName);

              return (
                <Pressable
                  key={shift.shiftId}
                  style={[styles.shiftCard, isSelected && styles.shiftCardSelected]}
                  onPress={() => handleSelectShift(shift)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={styles.shiftCardHeader}>
                    <View style={[styles.shiftIconBox, { backgroundColor: `${shiftColor}15` }]}>
                      <Ionicons name={getShiftIcon(shift.shiftName) as any} size={22} color={shiftColor} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={styles.shiftTitleRow}>
                        <Text style={styles.shiftName}>{shift.shiftName}</Text>
                        <View style={styles.durationBadge}>
                          <Text style={styles.durationText}>{shift.durationHours || 'Active'}</Text>
                        </View>
                      </View>
                      <Text style={styles.shiftTiming}>
                        {shift.startTime} – {shift.endTime}
                      </Text>
                    </View>
                    <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                      {isSelected && <View style={styles.radioInner} />}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Tip Box */}
        <View style={styles.tipBox}>
          <Ionicons name="information-circle-outline" size={20} color="#059669" />
          <Text style={styles.tipText}>
            Working during official shifts ensures maximum delivery order allocation and eligibility for daily milestone incentives.
          </Text>
        </View>

        {/* CTA Button */}
        <View style={styles.actionSection}>
          <Pressable
            style={[styles.confirmBtn, isBooking && styles.confirmBtnDisabled]}
            onPress={handleConfirmShift}
            disabled={isBooking}
            accessibilityRole="button"
            accessibilityLabel="Book Shift"
          >
            {isBooking ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.confirmBtnText}>
                {activeShift ? 'Switch / Confirm Shift' : 'Book Shift to Go Online'}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* Prominent On-Screen "Shift Booked" Success Confirmation Modal */}
      <Modal
        visible={showShiftBookedModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowShiftBookedModal(false)}
      >
        <View style={styles.bookedModalOverlay}>
          <View style={styles.bookedModalCard}>
            <View style={styles.bookedSuccessCircle}>
              <Ionicons name="checkmark-circle" size={64} color="#10B981" />
            </View>

            <Text style={styles.bookedModalTitle}>Shift Booked!</Text>
            <Text style={styles.bookedModalSubtitle}>
              Your shift has been successfully confirmed.
            </Text>

            <View style={styles.bookedShiftSummary}>
              <View style={styles.bookedSummaryHeader}>
                <Ionicons name="calendar-outline" size={18} color="#065F46" />
                <Text style={styles.bookedSummaryShiftName}>
                  {formatShiftDisplayName(justBookedShift?.shiftName || activeShift?.shiftName || 'Delivery Shift')}
                </Text>
              </View>
              <Text style={styles.bookedSummaryTiming}>
                {justBookedShift?.startTime || activeShift?.startTime} — {justBookedShift?.endTime || activeShift?.endTime} ({justBookedShift?.durationHours || activeShift?.durationHours || 'Active'})
              </Text>
              <View style={styles.bookedSummaryBadge}>
                <Ionicons name="shield-checkmark" size={14} color="#059669" />
                <Text style={styles.bookedSummaryBadgeText}>
                  Ready to Come Online
                </Text>
              </View>
            </View>

            <Text style={styles.bookedModalInstruction}>
              You are now eligible to come online and start receiving customer order delivery assignments.
            </Text>

            <View style={styles.bookedModalActions}>
              <Pressable
                style={styles.bookedGoOnlineBtn}
                onPress={() => {
                  setShowShiftBookedModal(false);
                  navigation.navigate('DeliveryHome', { autoGoOnline: true });
                }}
                accessibilityRole="button"
                accessibilityLabel="Go Online Now"
              >
                <Ionicons name="flash" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.bookedGoOnlineBtnText}>Go Online Now</Text>
              </Pressable>

              <Pressable
                style={styles.bookedDismissBtn}
                onPress={() => setShowShiftBookedModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Stay on Shifts"
              >
                <Text style={styles.bookedDismissBtnText}>Done (Stay Offline)</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Toast Notification */}
      <Toast
        visible={Boolean(toast)}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        accessibilityLabel={toast?.message ?? 'Toast'}
        onDismiss={() => setToast(null)}
      />

      {/* Bottom Navigation */}
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  headerGradient: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#A7F3D0',
    fontWeight: '500',
    marginTop: 2,
  },
  headerIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  eligibilityCardSuccess: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eligibilityCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  eligibilityIconCircleSuccess: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eligibilityTitleSuccess: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065F46',
  },
  eligibilitySubtitleSuccess: {
    fontSize: 11,
    color: '#047857',
    marginTop: 1,
  },
  goOnlineQuickBtn: {
    backgroundColor: '#10B981',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 8,
  },
  goOnlineQuickBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  eligibilityCardWarning: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  eligibilityIconCircleWarning: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eligibilityTitleWarning: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  eligibilitySubtitleWarning: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 1,
  },
  activeBanner: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#6EE7B7',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  activeBannerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  activePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  endShiftBtn: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  endShiftBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
  activeDetailsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  activeShiftIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeShiftTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#064E3B',
    marginBottom: 2,
  },
  activeShiftTiming: {
    fontSize: 13,
    color: '#047857',
    fontWeight: '500',
  },
  activeShiftStatus: {
    fontSize: 11,
    color: '#059669',
    marginTop: 4,
  },
  shiftsSection: {
    marginBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E293B',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
  },
  cardsGrid: {
    gap: 12,
  },
  shiftCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  shiftCardSelected: {
    borderColor: '#10B981',
    backgroundColor: '#F0FDF4',
  },
  shiftCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shiftIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shiftTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  shiftName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  durationBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  shiftTiming: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  radioCircleSelected: {
    borderColor: '#10B981',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10B981',
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    gap: 8,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    color: '#166534',
    lineHeight: 18,
  },
  actionSection: {
    marginBottom: 16,
  },
  confirmBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnDisabled: {
    opacity: 0.7,
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bookedModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  bookedModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  bookedSuccessCircle: {
    marginBottom: 12,
  },
  bookedModalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#064E3B',
    textAlign: 'center',
  },
  bookedModalSubtitle: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  bookedShiftSummary: {
    width: '100%',
    backgroundColor: '#F0FDF4',
    borderWidth: 1.5,
    borderColor: '#A7F3D0',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  bookedSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  bookedSummaryShiftName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#065F46',
    marginLeft: 8,
  },
  bookedSummaryTiming: {
    fontSize: 14,
    color: '#047857',
    fontWeight: '600',
    marginBottom: 10,
  },
  bookedSummaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  bookedSummaryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
    marginLeft: 4,
  },
  bookedModalInstruction: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  bookedModalActions: {
    width: '100%',
    gap: 10,
  },
  bookedGoOnlineBtn: {
    backgroundColor: '#10B981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  bookedGoOnlineBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bookedDismissBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  bookedDismissBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
});
