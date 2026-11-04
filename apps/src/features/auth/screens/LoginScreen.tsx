/* eslint-disable @typescript-eslint/no-var-requires */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  ActivityIndicator,
  Image,
  TextInput as RNTextInput,
} from 'react-native';
import { OTP_REGEX } from '@/utils/regex';
import { Text } from '@/components/Text';
import { Toast } from '@/components/Toast';
import { trackAnalyticsEvent } from '@/utils/analytics';
import { useApiErrorHandler } from '@/hooks/useApiErrorHandler';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequestOtpMutation, useVerifyOtpMutation } from '@/api/endpoints/authApi';
import { toUnwrappedApiError } from '../apiError';
import { isValidDeliveryPhone, normalizeDeliveryPhone } from '../phone';
import { applyAuthSession } from '../session';
import { useAppDispatch } from '@/store/hooks';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '@/navigation/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const brandLogo = require('../../../assets/delivery_logo.png');

const RESEND_COOLDOWN_SEC = 30;

type Step = 'phone' | 'otp';

export function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const dispatch = useAppDispatch();
  const { isConnected } = useConnectivity();
  const [step, setStep] = useState<Step>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [otpError, setOtpError] = useState<string | undefined>();
  const [toast, setToast] = useState<{
    message: string;
    variant: 'error' | 'info' | 'success';
  } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [requestOtp, requestState] = useRequestOtpMutation();
  const [verifyOtp, verifyState] = useVerifyOtpMutation();

  // Custom states for premium UI focus tracking
  const [isPhoneFocused, setIsPhoneFocused] = useState(false);
  const [isOtpFocused, setIsOtpFocused] = useState(false);

  const showError = useCallback((message: string) => {
    setToast({ message, variant: 'error' });
  }, []);

  const handleApiError = useApiErrorHandler({
    onInlineField: (error) => {
      if (error.fields?.phoneNumber) setPhoneError(error.fields.phoneNumber);
      else if (error.fields?.otp) setOtpError(error.fields.otp);
      else showError(error.message);
      if (error.code === 'RATE_LIMITED') setCooldown(RESEND_COOLDOWN_SEC);
    },
    onToast: (error) => {
      showError(error.message);
      if (error.code === 'RATE_LIMITED') setCooldown(RESEND_COOLDOWN_SEC);
    },
    onForceLogout: (error) => showError(error.message),
    onFullScreen: (error) => showError(error.message),
    onModalBlocking: (error) => showError(error.message),
    onGeneric: (error) => showError(error.message),
  });

  useEffect(() => {
    trackAnalyticsEvent('delivery_login_viewed');
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((c: number) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const onRequestOtp = async () => {
    setPhoneError(undefined);
    if (!isConnected) {
      showError('You are offline. Connect to request an OTP.');
      return;
    }
    const normalized = normalizeDeliveryPhone(phoneInput);
    if (!isValidDeliveryPhone(normalized)) {
      setPhoneError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    trackAnalyticsEvent('otp_request_tapped');
    try {
      await requestOtp({ phoneNumber: normalized }).unwrap();
      trackAnalyticsEvent('auth_otp_requested');
      setPhoneNumber(normalized);
      setStep('otp');
      setCooldown(RESEND_COOLDOWN_SEC);
      setOtp('');
      setOtpError(undefined);
    } catch (err) {
      handleApiError(toUnwrappedApiError(err));
    }
  };

  const onVerify = async () => {
    setOtpError(undefined);
    if (!isConnected) {
      showError('You are offline. Connect to verify the OTP.');
      return;
    }
    if (!OTP_REGEX.test(otp)) {
      setOtpError('Enter the 6-digit verification code.');
      return;
    }
    trackAnalyticsEvent('otp_submitted');
    try {
      const data = await verifyOtp({
        phoneNumber,
        otp,
        userType: 'DELIVERY_PARTNER',
      }).unwrap();
      trackAnalyticsEvent('auth_otp_verified');
      await applyAuthSession(dispatch, data, phoneNumber);
    } catch (err) {
      handleApiError(toUnwrappedApiError(err));
    }
  };

  const onResend = async () => {
    if (!isConnected) {
      showError('You are offline. Connect to resend the OTP.');
      return;
    }
    if (cooldown > 0) return;
    trackAnalyticsEvent('otp_request_tapped');
    try {
      await requestOtp({ phoneNumber }).unwrap();
      setCooldown(RESEND_COOLDOWN_SEC);
      setToast({ message: 'A new code was sent.', variant: 'success' });
    } catch (err) {
      handleApiError(toUnwrappedApiError(err));
    }
  };

  const busy = requestState.isLoading || verifyState.isLoading;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Curved Header Background Design */}
        <View style={styles.topCurveContainer}>
          <Image
            source={brandLogo}
            style={styles.brandLogo}
            resizeMode="cover"
          />
          <Text style={styles.brandNameText}>Delimo</Text>
          <View style={styles.badgeContainer}>
            <Text style={styles.badgeText}>DELIVERY PARTNER</Text>
          </View>
        </View>

        {/* Premium Content Form Card */}
        <View style={styles.formCard}>
          <Text style={styles.mainTitle}>
            {step === 'phone' ? 'Welcome Partner' : 'Verify Code'}
          </Text>
          <Text style={styles.subtitle}>
            {step === 'phone'
              ? 'Sign in to access your delivery dashboard, track assignments, and view earnings.'
              : `Enter the 6-digit OTP sent to registered number +91 ${phoneNumber.replace('+91', '')}`}
          </Text>

          {step === 'phone' ? (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Mobile Number</Text>

              <View
                style={[
                  styles.phoneInputWrapper,
                  isPhoneFocused && styles.inputWrapperFocused,
                  phoneError ? styles.inputWrapperError : null,
                ]}
              >
                <Text style={styles.countryCode}>🇮🇳 +91</Text>
                <View style={styles.divider} />
                <RNTextInput
                  value={phoneInput}
                  onChangeText={(text: string) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setPhoneInput(cleaned);
                  }}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  placeholder="98765 43210"
                  placeholderTextColor="#9EA6B2"
                  onFocus={() => setIsPhoneFocused(true)}
                  onBlur={() => setIsPhoneFocused(false)}
                  style={styles.customInput}
                  editable={!busy}
                />
              </View>
              {phoneError ? (
                <Text style={styles.errorText}>{phoneError}</Text>
              ) : null}

              <TouchableOpacity
                onPress={() => void onRequestOtp()}
                disabled={busy}
                style={[styles.primaryButton, busy && styles.buttonDisabled]}
                activeOpacity={0.8}
              >
                {requestState.isLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Get OTP Code</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Verification Code</Text>

              <View
                style={[
                  styles.phoneInputWrapper,
                  isOtpFocused && styles.inputWrapperFocused,
                  otpError ? styles.inputWrapperError : null,
                ]}
              >
                <Text style={styles.otpIcon}>🔑</Text>
                <View style={styles.divider} />
                <RNTextInput
                  value={otp}
                  onChangeText={(text: string) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setOtp(cleaned);
                  }}
                  keyboardType="number-pad"
                  placeholder="Enter 6-digit OTP"
                  placeholderTextColor="#9EA6B2"
                  maxLength={6}
                  onFocus={() => setIsOtpFocused(true)}
                  onBlur={() => setIsOtpFocused(false)}
                  style={styles.customInput}
                  editable={!busy}
                />
              </View>
              {otpError ? (
                <Text style={styles.errorText}>{otpError}</Text>
              ) : null}

              <TouchableOpacity
                onPress={() => void onVerify()}
                disabled={busy}
                style={[styles.primaryButton, busy && styles.buttonDisabled]}
                activeOpacity={0.8}
              >
                {verifyState.isLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Verify & Proceed</Text>
                )}
              </TouchableOpacity>

              <View style={styles.otpActionsContainer}>
                <TouchableOpacity
                  onPress={() => void onResend()}
                  disabled={busy || cooldown > 0}
                  style={styles.secondaryButton}
                >
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      (busy || cooldown > 0) && styles.disabledSecondaryText,
                    ]}
                  >
                    {cooldown > 0 ? `Resend Code in ${cooldown}s` : 'Resend Code'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setStep('phone');
                    setOtp('');
                    setOtpError(undefined);
                  }}
                  disabled={busy}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.changeNumberText}>Edit Number</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* SSL & Secure T&C Badging Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerSecureText}>🔒 Secure SSL Encrypted Session</Text>
          <Text style={styles.footerTermsText}>
            By continuing, you agree to our{' '}
            <Text
              style={styles.linkText}
              onPress={() => navigation.navigate('TermsAndConditions')}
              accessibilityRole="link"
            >
              Terms of Service
            </Text>{' '}
            &{' '}
            <Text
              style={styles.linkText}
              onPress={() => navigation.navigate('PrivacyPolicy')}
              accessibilityRole="link"
            >
              Privacy Policy
            </Text>
          </Text>
        </View>
      </ScrollView>

      <Toast
        visible={Boolean(toast)}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        accessibilityLabel="Login message"
        onDismiss={() => setToast(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  scrollContainer: {
    flexGrow: 1,
  },
  topCurveContainer: {
    height: 250,
    backgroundColor: '#14532D',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Platform.OS === 'ios' ? 40 : 20,
    shadowColor: '#14532D',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  brandLogo: {
    width: 90,
    height: 90,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
  },
  brandNameText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 12,
    letterSpacing: 0.5,
  },
  badgeContainer: {
    backgroundColor: '#F59E0B',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginHorizontal: 20,
    marginTop: -30,
    paddingHorizontal: 24,
    paddingVertical: 28,
    shadowColor: '#95A5A6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  mainTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A202C',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: '#718096',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  inputContainer: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  phoneInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    height: 54,
    paddingHorizontal: 16,
  },
  inputWrapperFocused: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFFFF',
  },
  inputWrapperError: {
    borderColor: '#E23744',
  },
  countryCode: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A202C',
  },
  otpIcon: {
    fontSize: 16,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: '#CBD5E0',
    marginHorizontal: 12,
  },
  customInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#1A202C',
    height: '100%',
    padding: 0,
  },
  errorText: {
    fontSize: 12,
    color: '#E23744',
    fontWeight: '500',
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: '#F59E0B',
    borderRadius: 12,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  otpActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  secondaryButton: {
    paddingVertical: 8,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: '#F59E0B',
    fontWeight: '600',
  },
  disabledSecondaryText: {
    color: '#A0AEC0',
  },
  changeNumberText: {
    fontSize: 14,
    color: '#718096',
    fontWeight: '600',
  },
  footer: {
    marginTop: 'auto',
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  footerSecureText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#A0AEC0',
  },
  footerTermsText: {
    fontSize: 11,
    color: '#718096',
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 16,
  },
  linkText: {
    color: '#F59E0B',
    fontWeight: '600',
  },
});
