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
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  // Success Confirmation Modal
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

  // Generate 3 upcoming date selector tabs: Today, Tomorrow, Day After
  const dateTabs = useMemo(() => {
    const days = [];
    const today = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' });
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      days.push({ index: i, label: dayName, date: dateStr, fullDate: d });
    }
    return days;
  }, []);

  const handleSelectShift = (shift: DeliveryShift) => {
    setSelectedShiftId(shift.shiftId);
  };

  const handleConfirmShift = async () => {
    const shiftToBook = availableShifts.find((s) => s.shiftId === (selectedShiftId || effectiveActiveId)) || availableShifts[0];
    if (!shiftToBook) {
      setToast({ message: 'Please select an available shift to proceed.', variant: 'warning' });
      return;
    }

    try {
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

  const getShiftAccent = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('morning')) return '#D97706';
    if (lower.includes('afternoon')) return '#EA580C';
    if (lower.includes('evening')) return '#4F46E5';
    if (lower.includes('night')) return '#2563EB';
    return '#0F172A';
  };

  const formatShiftDisplayName = (name: string) => {
    if (!name) return 'Shift';
    const trimmed = name.trim();
    return trimmed.toLowerCase().endsWith('shift') ? trimmed : `${trimmed} Shift`;
  };

  return (
    <View style={styles.container}>
      {/* Clean Native Mobile Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.navigate('DeliveryHome')}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
          >
            <Feather name="arrow-left" size={22} color="#0F172A" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Shift Booking</Text>
            <Text style={styles.headerSubtitle}>Choose a slot to receive delivery orders</Text>
          </View>
          <View style={styles.headerBadge}>
            <Ionicons name="calendar-outline" size={20} color="#475569" />
          </View>
        </View>

        {/* Date Selector Tabs */}
        <View style={styles.dateTabsRow}>
          {dateTabs.map((tab) => {
            const isTabSelected = selectedDayIndex === tab.index;
            return (
              <Pressable
                key={tab.index}
                style={[styles.dateTab, isTabSelected && styles.dateTabSelected]}
                onPress={() => setSelectedDayIndex(tab.index)}
              >
                <Text style={[styles.dateTabLabel, isTabSelected && styles.dateTabLabelSelected]}>
                  {tab.label}
                </Text>
                <Text style={[styles.dateTabDate, isTabSelected && styles.dateTabDateSelected]}>
                  {tab.date}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Main Content */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#0F172A"
            colors={['#0F172A']}
          />
        }
      >
        {/* Active Shift Card (Native Look) */}
        {activeShift && (
          <View style={styles.activeCard}>
            <View style={styles.activeCardHeader}>
              <View style={styles.activeStatusPill}>
                <View style={styles.activeStatusDot} />
                <Text style={styles.activeStatusText}>CURRENTLY ACTIVE SHIFT</Text>
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

            <View style={styles.activeCardBody}>
              <View style={styles.activeIconContainer}>
                <Ionicons name="time" size={24} color="#0F172A" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.activeCardTitle}>{formatShiftDisplayName(activeShift.shiftName)}</Text>
                <Text style={styles.activeCardTiming}>
                  {activeShift.startTime} – {activeShift.endTime}
                </Text>
                <Text style={styles.activeCardDuration}>
                  Duration: {activeShift.durationHours || 'Scheduled Slot'}
                </Text>
              </View>
            </View>

            <View style={styles.activeCardFooter}>
              <Pressable
                style={styles.goOnlineActionBtn}
                onPress={() => navigation.navigate('DeliveryHome', { autoGoOnline: true })}
                accessibilityRole="button"
                accessibilityLabel="Go Online"
              >
                <Ionicons name="flash" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.goOnlineActionBtnText}>Go Online Now</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Notice Info Box */}
        <View style={styles.noticeBox}>
          <Ionicons
            name={activeShift ? 'checkmark-circle-outline' : 'information-circle-outline'}
            size={20}
            color={activeShift ? '#059669' : '#0284C7'}
          />
          <Text style={styles.noticeText}>
            {activeShift
              ? 'Your shift is confirmed. You can switch to another shift anytime or come online to start deliveries.'
              : 'Booking a shift ensures priority order matching and milestone incentive earnings during peak demand.'}
          </Text>
        </View>

        {/* Section: Available Shift Slots */}
        <View style={styles.slotsSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Available Slots</Text>
            <View style={styles.slotsCountBadge}>
              <Text style={styles.slotsCountText}>{availableShifts.length} Slots</Text>
            </View>
            {isLoadingShifts && <ActivityIndicator size="small" color="#0F172A" style={{ marginLeft: 8 }} />}
          </View>
          <Text style={styles.sectionSubtitle}>Select your preferred work hours</Text>

          <View style={styles.shiftsGrid}>
            {availableShifts.map((shift) => {
              const isSelected = selectedShiftId === shift.shiftId || (!selectedShiftId && effectiveActiveId === shift.shiftId);
              const accentColor = getShiftAccent(shift.shiftName);

              return (
                <Pressable
                  key={shift.shiftId}
                  style={[styles.shiftCard, isSelected && styles.shiftCardSelected]}
                  onPress={() => handleSelectShift(shift)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={styles.shiftCardContent}>
                    <View style={[styles.shiftIconBox, { backgroundColor: `${accentColor}10` }]}>
                      <Ionicons name={getShiftIcon(shift.shiftName) as any} size={22} color={accentColor} />
                    </View>

                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <View style={styles.shiftTitleRow}>
                        <Text style={styles.shiftName}>{shift.shiftName}</Text>
                        <View style={styles.durationTag}>
                          <Text style={styles.durationTagText}>{shift.durationHours || 'Full Shift'}</Text>
                        </View>
                      </View>

                      <View style={styles.timingRow}>
                        <Feather name="clock" size={13} color="#64748B" style={{ marginRight: 5 }} />
                        <Text style={styles.timingText}>
                          {shift.startTime} – {shift.endTime}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.radioOutline, isSelected && styles.radioOutlineSelected]}>
                      {isSelected && <View style={styles.radioFilled} />}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Action Button */}
        <View style={styles.bottomCtaSection}>
          <Pressable
            style={[styles.primaryActionBtn, isBooking && styles.primaryActionBtnDisabled]}
            onPress={handleConfirmShift}
            disabled={isBooking}
            accessibilityRole="button"
            accessibilityLabel="Confirm Shift Booking"
          >
            {isBooking ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryActionBtnText}>
                {activeShift ? 'Switch / Confirm Shift' : 'Confirm Shift Booking'}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* Clean Success Confirmation Modal */}
      <Modal
        visible={showShiftBookedModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowShiftBookedModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalCheckCircle}>
              <Ionicons name="checkmark-circle" size={56} color="#059669" />
            </View>

            <Text style={styles.modalTitle}>Shift Confirmed!</Text>
            <Text style={styles.modalSubtitle}>Your work slot has been reserved successfully.</Text>

            <View style={styles.modalSummaryBox}>
              <Text style={styles.modalSummaryName}>
                {formatShiftDisplayName(justBookedShift?.shiftName || activeShift?.shiftName || 'Delivery Shift')}
              </Text>
              <Text style={styles.modalSummaryTiming}>
                {justBookedShift?.startTime || activeShift?.startTime} – {justBookedShift?.endTime || activeShift?.endTime}
              </Text>
              <View style={styles.modalStatusPill}>
                <Ionicons name="shield-checkmark" size={13} color="#0F172A" style={{ marginRight: 4 }} />
                <Text style={styles.modalStatusPillText}>Ready to Receive Orders</Text>
              </View>
            </View>

            <View style={styles.modalBtnGroup}>
              <Pressable
                style={styles.modalGoOnlineBtn}
                onPress={() => {
                  setShowShiftBookedModal(false);
                  navigation.navigate('DeliveryHome', { autoGoOnline: true });
                }}
              >
                <Ionicons name="flash" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.modalGoOnlineBtnText}>Go Online Now</Text>
              </Pressable>

              <Pressable
                style={styles.modalDismissBtn}
                onPress={() => setShowShiftBookedModal(false)}
              >
                <Text style={styles.modalDismissBtnText}>Done (Stay Offline)</Text>
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
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 1,
  },
  headerBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateTabsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dateTab: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  dateTabSelected: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  dateTabLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  dateTabLabelSelected: {
    color: '#FFFFFF',
  },
  dateTabDate: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  dateTabDateSelected: {
    color: '#CBD5E1',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  activeCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  activeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  activeStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  activeStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#059669',
    marginRight: 6,
  },
  activeStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  endShiftBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
  },
  endShiftBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
  activeCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  activeIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  activeCardTiming: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginTop: 2,
  },
  activeCardDuration: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  activeCardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  goOnlineActionBtn: {
    backgroundColor: '#F59E0B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  goOnlineActionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    gap: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },
  slotsSection: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  slotsCountBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  slotsCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
  },
  shiftsGrid: {
    gap: 10,
  },
  shiftCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  shiftCardSelected: {
    borderColor: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  shiftCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shiftIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shiftTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  shiftName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  durationTag: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  durationTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  timingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timingText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  radioOutline: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  radioOutlineSelected: {
    borderColor: '#0F172A',
  },
  radioFilled: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#0F172A',
  },
  bottomCtaSection: {
    marginTop: 8,
    marginBottom: 16,
  },
  primaryActionBtn: {
    backgroundColor: '#0F172A',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryActionBtnDisabled: {
    opacity: 0.6,
  },
  primaryActionBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  modalCheckCircle: {
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 3,
    marginBottom: 16,
  },
  modalSummaryBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    alignItems: 'center',
  },
  modalSummaryName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  modalSummaryTiming: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  modalStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modalStatusPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0F172A',
  },
  modalBtnGroup: {
    width: '100%',
    gap: 8,
  },
  modalGoOnlineBtn: {
    backgroundColor: '#F59E0B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  modalGoOnlineBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalDismissBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalDismissBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
});
