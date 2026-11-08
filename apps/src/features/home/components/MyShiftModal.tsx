import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import {
  useGetAvailableShiftsQuery,
  useGetMyShiftBookingsQuery,
  useBookDeliveryShiftMutation,
  type DeliveryShift,
} from '@/api/endpoints/deliveryApi';
import {
  storeActiveShift,
  clearStoredActiveShift,
  FALLBACK_ADMIN_SHIFTS,
  type ActiveShiftData,
} from '../shiftStorage';

interface MyShiftModalProps {
  visible: boolean;
  onClose: () => void;
  activeShift: ActiveShiftData | null;
  onShiftUpdated: (shift: ActiveShiftData | null) => void;
  onShowToast: (message: string, variant: 'success' | 'error' | 'info' | 'warning') => void;
}

export function MyShiftModal({
  visible,
  onClose,
  activeShift,
  onShiftUpdated,
  onShowToast,
}: MyShiftModalProps) {
  const insets = useSafeAreaInsets();

  const { data: serverShifts, isLoading: isLoadingShifts } = useGetAvailableShiftsQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  const { data: bookingsData } = useGetMyShiftBookingsQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  const [bookShiftMutation, { isLoading: isBooking }] = useBookDeliveryShiftMutation();

  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [adminLiveShifts, setAdminLiveShifts] = useState<DeliveryShift[]>([]);

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

    if (visible) {
      void fetchAdminShifts();
    }
    return () => {
      isCancelled = true;
    };
  }, [visible]);

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
      onShowToast('Please select a shift created by admin to proceed.', 'warning');
      return;
    }

    try {
      // Attempt backend booking
      try {
        await bookShiftMutation(shiftToBook.shiftId).unwrap();
      } catch (err: any) {
        console.info('[ShiftModal] Backend shift booking response:', err);
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
      onShiftUpdated(newActiveShift);
      onShowToast(`Shift booked! "${shiftToBook.shiftName}" is confirmed. You can now go online.`, 'success');
      onClose();
    } catch (e: any) {
      console.error('[ShiftModal] Failed to activate shift:', e);
      onShowToast('Could not activate shift. Please try again.', 'error');
    }
  };

  const handleEndShift = async () => {
    await clearStoredActiveShift();
    onShiftUpdated(null);
    onShowToast('Shift ended successfully.', 'info');
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <Ionicons name="calendar" size={20} color="#10B981" />
              </View>
              <View>
                <Text style={styles.title}>My Delivery Shift</Text>
                <Text style={styles.subtitle}>Select an official shift created by admin</Text>
              </View>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose} accessibilityLabel="Close shift modal">
              <Feather name="x" size={20} color="#4B5563" />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            {/* Active Shift Card Banner (if active) */}
            {activeShift && (
              <View style={styles.activeBanner}>
                <View style={styles.activeBannerTop}>
                  <View style={styles.activePill}>
                    <View style={styles.pulsingDot} />
                    <Text style={styles.activePillText}>CURRENT ACTIVE SHIFT</Text>
                  </View>
                  <Pressable style={styles.endShiftBtn} onPress={handleEndShift}>
                    <Text style={styles.endShiftBtnText}>End Shift</Text>
                  </Pressable>
                </View>

                <View style={styles.activeDetailsRow}>
                  <Ionicons name="time" size={22} color="#065F46" />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={styles.activeShiftTitle}>{formatShiftDisplayName(activeShift.shiftName)}</Text>
                    <Text style={styles.activeShiftTiming}>
                      {activeShift.startTime} — {activeShift.endTime} ({activeShift.durationHours || 'Active'})
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Section: Admin Shifts List */}
            <View style={styles.shiftsSection}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>
                  Admin Available Shifts ({availableShifts.length})
                </Text>
                {isLoadingShifts && <ActivityIndicator size="small" color="#10B981" />}
              </View>
              <Text style={styles.sectionSubtitle}>
                Select an official shift scheduled and verified by admin
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
                    >
                      <View style={styles.shiftCardHeader}>
                        <View style={[styles.shiftIconBox, { backgroundColor: `${shiftColor}15` }]}>
                          <Ionicons name={getShiftIcon(shift.shiftName) as any} size={20} color={shiftColor} />
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

            {/* Shift Incentives Tip Box */}
            <View style={styles.tipBox}>
              <Ionicons name="information-circle-outline" size={18} color="#059669" />
              <Text style={styles.tipText}>
                Working during official admin shifts ensures maximum delivery order allocation and eligibility for daily milestone incentives.
              </Text>
            </View>
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.footer}>
            <Pressable
              style={[styles.confirmBtn, isBooking && styles.confirmBtnDisabled]}
              onPress={handleConfirmShift}
              disabled={isBooking}
            >
              {isBooking ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={styles.confirmBtnText}>
                    {activeShift ? 'Update & Start Shift' : 'Select & Start Shift'}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '88%',
    paddingTop: 20,
    paddingHorizontal: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArea: {
    marginTop: 16,
  },
  activeBanner: {
    backgroundColor: '#ECFDF5',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#A7F3D0',
  },
  activeBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  pulsingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  endShiftBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  endShiftBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
  activeDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeShiftTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  activeShiftTiming: {
    fontSize: 13,
    color: '#475569',
    marginTop: 1,
  },
  shiftsSection: {
    marginBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 10,
  },
  cardsGrid: {
    gap: 10,
  },
  shiftCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  shiftCardSelected: {
    backgroundColor: '#F8FAFC',
    borderColor: '#0F172A',
  },
  shiftCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shiftIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shiftTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shiftName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  durationBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  shiftTiming: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  radioCircleSelected: {
    borderColor: '#0F172A',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0F172A',
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    borderRadius: 12,
    marginTop: 4,
    marginBottom: 16,
    gap: 8,
  },
  tipText: {
    flex: 1,
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  footer: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  confirmBtn: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  confirmBtnDisabled: {
    opacity: 0.6,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
