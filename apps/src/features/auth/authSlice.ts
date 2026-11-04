import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { UserType } from '@/types/auth';

/**
 * authSlice — Blueprint §11.1.
 * Identity/session only. No profile fields.
 */
export type AuthStatus =
  | 'idle'
  | 'authenticating'
  | 'authenticated'
  | 'unauthenticated';

export type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  userType: UserType | null;
  userId: string | null;
  phoneNumber?: string | null;
  isNewUser: boolean;
  authStatus: AuthStatus;
};

const initialState: AuthState = {
  accessToken: null,
  refreshToken: null,
  userType: null,
  userId: null,
  phoneNumber: null,
  isNewUser: false,
  authStatus: 'unauthenticated',
};

export type SetCredentialsPayload = {
  accessToken: string;
  refreshToken: string;
  userType: UserType;
  userId: string;
  phoneNumber?: string | null;
  isNewUser?: boolean;
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<SetCredentialsPayload>) {
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.userType = action.payload.userType;
      state.userId = action.payload.userId;
      if (action.payload.phoneNumber !== undefined) {
        state.phoneNumber = action.payload.phoneNumber;
      }
      state.isNewUser = Boolean(action.payload.isNewUser);
      state.authStatus = 'authenticated';
    },
    setAuthStatus(state, action: PayloadAction<AuthStatus>) {
      state.authStatus = action.payload;
    },
    clearIsNewUser(state) {
      state.isNewUser = false;
    },
    clearCredentials() {
      return initialState;
    },
  },
});

export const { setCredentials, setAuthStatus, clearIsNewUser, clearCredentials } =
  authSlice.actions;

export const selectAccessToken = (state: { auth: AuthState }) =>
  state.auth.accessToken;
export const selectRefreshToken = (state: { auth: AuthState }) =>
  state.auth.refreshToken;
export const selectIsAuthenticated = (state: { auth: AuthState }) =>
  state.auth.authStatus === 'authenticated';
export const selectAuthStatus = (state: { auth: AuthState }) =>
  state.auth.authStatus;
export const selectUserType = (state: { auth: AuthState }) => state.auth.userType;
export const selectUserId = (state: { auth: AuthState }) => state.auth.userId;
export const selectPhoneNumber = (state: { auth: AuthState }) => state.auth.phoneNumber;
export const selectIsNewUser = (state: { auth: AuthState }) => state.auth.isNewUser;

export default authSlice.reducer;
