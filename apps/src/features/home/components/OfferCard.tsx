import React from 'react';
import { View, Linking, Platform, Pressable, StyleSheet } from 'react-native';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { Feather, Ionicons } from '@expo/vector-icons';
import type { DeliveryOffer } from '../types';
import { formatDistanceKm } from '../types';

type Props = {
  offer: DeliveryOffer;
  accepting: boolean;
  acceptDisabled: boolean;
  onAccept: () => void;
  onReject?: () => void;
};

/** Offer row with Pickup, Drop point, distance and navigation options */
export function OfferCard({
  offer,
  accepting,
  acceptDisabled,
  onAccept,
  onReject,
}: Props) {
  const formattedFee = React.useMemo(() => {
    if (offer.estimatedFee !== undefined && offer.estimatedFee !== null) {
      const num = Number(offer.estimatedFee);
      if (!isNaN(num)) {
        return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
      }
      return String(offer.estimatedFee);
    }
    return '0';
  }, [offer.estimatedFee]);

  const openNavigation = (address: string) => {
    if (!address) return;
    const url =
      Platform.OS === 'ios'
        ? `maps:?q=${encodeURIComponent(address)}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    void Linking.openURL(url).catch(() => {});
  };

  return (
    <View
      style={styles.cardContainer}
      accessibilityLabel={`Offer from ${offer.restaurantName}`}
    >
      <View style={styles.topRow}>
        <View style={styles.iconSpaced}>
          <View style={styles.restaurantIconCircle}>
            <Text style={styles.restaurantIconText}>{offer.restaurantName.charAt(0)}</Text>
          </View>
        </View>
        <View style={styles.titleContainer}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Text style={styles.restaurantTitle}>{offer.restaurantName}</Text>
            {offer.orderNumber ? (
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#14532D', backgroundColor: '#F0FDF4', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                #{offer.orderNumber}
              </Text>
            ) : null}
          </View>

          {offer.expectedFoodReadyTime ? (
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#B45309', marginBottom: 2 }}>
              ⏱ Food Ready: {new Date(offer.expectedFoodReadyTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          ) : null}
        </View>
        <View style={styles.priceContainer}>
          <Text style={styles.priceLabel}>Earn</Text>
          <Text style={styles.priceAmount}>₹{formattedFee}</Text>
        </View>
      </View>

      {/* Pickup & Drop Points Route Box */}
      <View style={styles.routeBox}>
        {/* Pickup Item */}
        <View style={styles.routeItem}>
          <View style={styles.routeIconPickup}>
            <Ionicons name="storefront" size={14} color="#15803D" />
          </View>
          <View style={{ flex: 1, marginHorizontal: 8 }}>
            <Text style={styles.routeLabelPickup}>PICKUP POINT</Text>
            <Text style={styles.routeAddress} numberOfLines={2}>
              {offer.pickupAddress || offer.restaurantName}
            </Text>
          </View>
          <Pressable
            style={styles.navChip}
            onPress={() => openNavigation(offer.pickupAddress || offer.restaurantName)}
            accessibilityRole="button"
            accessibilityLabel="Open pickup location in maps"
          >
            <Feather name="navigation" size={11} color="#15803D" />
            <Text style={styles.navChipText}>Map</Text>
          </Pressable>
        </View>

        {/* Route connector with distance badge */}
        <View style={styles.routeConnectorRow}>
          <View style={styles.routeDottedLine} />
          <View style={styles.distanceBadge}>
            <Ionicons name="navigate-circle" size={13} color="#047857" />
            <Text style={styles.distanceText}>{formatDistanceKm(offer.estimatedDistance)}</Text>
          </View>
        </View>

        {/* Drop Location Item */}
        <View style={styles.routeItem}>
          <View style={styles.routeIconDrop}>
            <Ionicons name="location" size={14} color="#EA580C" />
          </View>
          <View style={{ flex: 1, marginHorizontal: 8 }}>
            <Text style={styles.routeLabelDrop}>DROP LOCATION</Text>
            <Text style={styles.routeAddress} numberOfLines={2}>
              {offer.deliveryAddress || 'Customer Delivery Address'}
            </Text>
          </View>
          {offer.deliveryAddress ? (
            <Pressable
              style={[styles.navChip, styles.navChipDrop]}
              onPress={() => openNavigation(offer.deliveryAddress!)}
              accessibilityRole="button"
              accessibilityLabel="Open drop location in maps"
            >
              <Feather name="navigation" size={11} color="#EA580C" />
              <Text style={[styles.navChipText, { color: '#EA580C' }]}>Map</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.bottomRow}>
        <View style={styles.buttonRow}>
          {onReject && (
            <Button
              label="Decline"
              accessibilityLabel={`Reject offer from ${offer.restaurantName}`}
              disabled={acceptDisabled || accepting}
              onPress={onReject}
              variant="secondary"
              style={[styles.rejectButton, { flex: 1, marginRight: 12 }]}
            />
          )}
          <Button
            label={accepting ? 'Accepting...' : 'Accept Delivery'}
            accessibilityLabel={`Accept offer from ${offer.restaurantName}`}
            loading={accepting}
            disabled={acceptDisabled}
            onPress={onAccept}
            variant="primary"
            style={[styles.acceptButton, { flex: onReject ? 2 : 1 }]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  iconSpaced: {
    marginRight: 14,
  },
  restaurantIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  restaurantIconText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#EF4444',
  },
  titleContainer: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  restaurantTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1A202C',
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  priceContainer: {
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    minWidth: 76,
  },
  priceLabel: {
    fontSize: 11,
    color: '#10B981',
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  priceAmount: {
    fontSize: 20,
    fontWeight: '900',
    color: '#14532D',
  },
  routeBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  routeItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeIconPickup: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeIconDrop: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFEDD5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeLabelPickup: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.5,
  },
  routeLabelDrop: {
    fontSize: 10,
    fontWeight: '800',
    color: '#EA580C',
    letterSpacing: 0.5,
  },
  routeAddress: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
    marginTop: 1,
  },
  routeConnectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 13,
    marginVertical: 4,
  },
  routeDottedLine: {
    width: 2,
    height: 18,
    backgroundColor: '#CBD5E1',
    marginRight: 10,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  distanceText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
    marginLeft: 4,
  },
  navChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 3,
  },
  navChipDrop: {
    backgroundColor: '#FFEDD5',
  },
  navChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginBottom: 16,
  },
  bottomRow: {
    flexDirection: 'column',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  rejectButton: {
    height: 54,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptButton: {
    height: 54,
    borderRadius: 16,
    backgroundColor: '#14532D',
    shadowColor: '#14532D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
