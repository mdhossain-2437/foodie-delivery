import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DeliveryHomeScreen } from '@/features/home/screens/DeliveryHomeScreen';
import { AvailabilityScreen } from '@/features/home/screens/AvailabilityScreen';
import { DeliveryOffersScreen } from '@/features/home/screens/DeliveryOffersScreen';
import { MyShiftScreen } from '@/features/home/screens/MyShiftScreen';
import { AssignmentDetailsScreen } from '@/features/home/screens/AssignmentDetailsScreen';
import { DeliveryNavigationScreen } from '@/features/navigation/screens/DeliveryNavigationScreen';
import { CustomerDeliveryScreen } from '@/features/navigation/screens/CustomerDeliveryScreen';
import { PickupOtpScreen } from '@/features/navigation/screens/PickupOtpScreen';
import { DeliveryOtpScreen } from '@/features/navigation/screens/DeliveryOtpScreen';
import { WalletScreen } from '@/features/wallet/screens/WalletScreen';
import { LedgerScreen } from '@/features/wallet/screens/LedgerScreen';
import { PayoutRequestsScreen } from '@/features/wallet/screens/PayoutRequestsScreen';
import { PayoutHistoryScreen } from '@/features/wallet/screens/PayoutHistoryScreen';
import { PayoutDetailScreen } from '@/features/wallet/screens/PayoutDetailScreen';
import { DeliveryNotificationsScreen } from '@/features/notifications/screens/DeliveryNotificationsScreen';
import { DeliveryProfileScreen } from '@/features/profile/screens/DeliveryProfileScreen';
import { DeliverySettingsScreen } from '@/features/profile/screens/DeliverySettingsScreen';
import { DeliveryBankDetailsScreen } from '@/features/profile/screens/DeliveryBankDetailsScreen';
import { DeliveryAddressScreen } from '@/features/profile/screens/DeliveryAddressScreen';
import { DeliveryZoneScreen } from '@/features/kyc/screens/DeliveryZoneScreen';
import { KycScreen } from '@/features/kyc/screens/KycScreen';
import { PendingVerificationScreen } from '@/features/kyc/screens/PendingVerificationScreen';
import { IncentivesScreen } from '@/features/home/screens/IncentivesScreen';
import { CashDepositScreen } from '@/features/wallet/screens/CashDepositScreen';
import { PrivacyPolicyScreen } from '@/features/profile/screens/PrivacyPolicyScreen';
import { TermsScreen } from '@/features/profile/screens/TermsScreen';
import { HelpAndSupportScreen } from '@/features/support/screens/HelpAndSupportScreen';
import type { MainStackParamList } from './types';
import { BottomNav } from './BottomNav';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useGetDeliveryProfileQuery } from '@/api/endpoints/deliveryApi';

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Main navigator — System Design §5.1 Delivery / P2-DEL-02…05:
 * single primary Home with modal stacks (no bottom tabs).
 */
export function MainNavigator({ initialRouteName }: { initialRouteName?: keyof MainStackParamList }) {
  const profileQuery = useGetDeliveryProfileQuery(undefined, { pollingInterval: 3000 });
  const navigation = useNavigation<any>();

  React.useEffect(() => {
    if (profileQuery.data?.kycStatus === 'SUSPENDED') {
      navigation.reset({
        index: 0,
        routes: [{ name: 'PendingVerification' }],
      });
    }
  }, [profileQuery.data?.kycStatus, navigation]);

  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName={profileQuery.data?.kycStatus === 'SUSPENDED' ? 'PendingVerification' : initialRouteName}
    >
      <Stack.Screen name="DeliveryHome" component={DeliveryHomeScreen} />
      <Stack.Screen
        name="Availability"
        component={AvailabilityScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Availability' }}
      />
      <Stack.Screen
        name="DeliveryOffers"
        component={DeliveryOffersScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Offers' }}
      />
      <Stack.Screen
        name="MyShift"
        component={MyShiftScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="AssignmentDetails"
        component={AssignmentDetailsScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Assignment' }}
      />
      <Stack.Screen
        name="DeliveryNavigation"
        component={DeliveryNavigationScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Navigation' }}
      />
      <Stack.Screen
        name="CustomerDelivery"
        component={CustomerDeliveryScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Delivery', headerBackVisible: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="PickupOtp"
        component={PickupOtpScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Pickup OTP', headerBackVisible: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="DeliveryOtp"
        component={DeliveryOtpScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Delivery OTP', headerBackVisible: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="Ledger"
        component={LedgerScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="PayoutRequests"
        component={PayoutRequestsScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="PayoutHistory"
        component={PayoutHistoryScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="PayoutDetail"
        component={PayoutDetailScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryNotifications"
        component={DeliveryNotificationsScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryProfile"
        component={DeliveryProfileScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="DeliverySettings"
        component={DeliverySettingsScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryBankDetails"
        component={DeliveryBankDetailsScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryAddress"
        component={DeliveryAddressScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryZone"
        component={DeliveryZoneScreen as any}
        options={{ presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen
        name="Kyc"
        component={KycScreen as any}
        options={{ presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen
        name="PendingVerification"
        component={PendingVerificationScreen}
        options={{ presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen
        name="Incentives"
        component={IncentivesScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="CashDeposit"
        component={CashDepositScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="HelpAndSupport"
        component={HelpAndSupportScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="PrivacyPolicy"
        component={PrivacyPolicyScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="TermsAndConditions"
        component={TermsScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
    </Stack.Navigator>
  );
}
