import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  EmailAuthProvider,
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signOut,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import { auth, db, firestoreCache } from '../services/firebase';
import type { CacheStatus } from '../services/firestoreCacheLifecycle';
import { clearPendingInvitation } from '../services/pendingInvitation';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  activateClinicianDemoWorkspace,
  CLINICIAN_DEMO_AVAILABLE,
  DEMO_CLINICIAN_ID,
  clearUnavailableDemoMarker,
  deactivateClinicianDemoWorkspace,
  forgetClinicianDemoWorkspace,
  isClinicianDemoRestoreRequested,
  isClinicianDemoWorkspace,
  rememberClinicianDemoWorkspace,
} from '../services/clinicianDemoBoundary';

export type UserRole = 'patient' | 'clinician' | null;

/**
 * `unsynced`: the signed-in user has writes the server has not accepted yet,
 * so nothing was done; ask before calling `logout({ discardUnsyncedWrites: true })`.
 */
export type LogoutOutcome = 'signed-out' | 'unsynced';

interface AuthContextType {
  user: User | null;
  role: UserRole;
  loading: boolean;
  isDemoWorkspace: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (email: string, pass: string, displayName?: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  selectRole: (role: UserRole) => Promise<void>;
  loginAsDemoClinician: () => Promise<void>;
  /**
   * Signs out and clears this device's Firestore cache, then reloads the app.
   * Unless `discardUnsyncedWrites` is set, it first waits briefly for queued
   * writes to upload and returns `unsynced` (doing nothing) if some remain.
   */
  logout: (options?: { discardUnsyncedWrites?: boolean }) => Promise<LogoutOutcome>;
  /** The Firestore cache lifecycle's state, for the loading screen. */
  cacheStatus: CacheStatus;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  isDemoWorkspace: false,
  login: async () => {},
  signup: async () => {},
  changePassword: async () => {},
  requestPasswordReset: async () => {},
  selectRole: async () => {},
  loginAsDemoClinician: async () => {},
  logout: async () => 'signed-out',
  cacheStatus: 'idle',
});

// Reliable Firestore role fetcher with timeout protection
const fetchUserRole = async (uid: string): Promise<UserRole> => {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, 'users', uid)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800)),
    ]);
    if (snap && snap.exists()) {
      return (snap.data()?.role as UserRole) || null;
    }
  } catch (err) {
    console.warn('Failed to fetch user role from Firestore:', err);
  }
  return null;
};

const DEMO_CLINICIAN_USER = {
  uid: DEMO_CLINICIAN_ID,
  email: 'dr.vance@waveable.clinic',
  displayName: 'Dr. Evelyn Vance, Ph.D.',
  emailVerified: true,
  isAnonymous: false,
  metadata: {},
  providerData: [],
  refreshToken: '',
  tenantId: null,
  delete: async () => {},
  getIdToken: async () => 'demo-token',
  getIdTokenResult: async () => ({} as any),
  reload: async () => {},
  toJSON: () => ({}),
  phoneNumber: null,
  photoURL: null,
  providerId: 'firebase',
} as unknown as User;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    clearUnavailableDemoMarker();
    deactivateClinicianDemoWorkspace();
    return null;
  });
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);
  const authGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const demoTransitionRef = useRef<'entering' | 'restoring' | null>(null);
  const identityRef = useRef<{ kind: 'production'; uid: string } | { kind: 'demo' } | null>(null);

  const isCurrentProductionIdentity = (generation: number, uid: string) => (
    mountedRef.current
    && authGenerationRef.current === generation
    && demoTransitionRef.current === null
    && identityRef.current?.kind === 'production'
    && identityRef.current.uid === uid
  );

  useEffect(() => {
    let isMounted = true;
    mountedRef.current = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!isMounted || !mountedRef.current) return;

        // Firebase emits a signed-out notification while the explicit demo
        // transition is awaiting signOut(). That notification is expected and
        // must not supersede the transition which requested it. Likewise, a
        // late signed-out notification must not tear down an active in-memory
        // demo workspace.
        if (demoTransitionRef.current || (isClinicianDemoWorkspace() && !currentUser)) return;
        // An explicit sign-out or account deletion owns the screen until the
        // page navigates away; its own auth events are not account changes.
        if (firestoreCache.isEnding()) return;

        const generation = ++authGenerationRef.current;
        if (isClinicianDemoRestoreRequested()) {
          demoTransitionRef.current = 'restoring';
          try {
            if (currentUser) await signOut(auth);
            if (!isMounted || !mountedRef.current || authGenerationRef.current !== generation) return;
            // The signed-out account's cached data goes before the demo starts.
            if ((await firestoreCache.prepareForUser(null)).status !== 'ready') return;
            if (!isMounted || !mountedRef.current || authGenerationRef.current !== generation) return;
            activateClinicianDemoWorkspace();
            identityRef.current = { kind: 'demo' };
            setUser(DEMO_CLINICIAN_USER);
            setRole('clinician');
            setLoading(false);
            demoTransitionRef.current = null;
            return;
          } catch (error) {
            if (!isMounted || !mountedRef.current || authGenerationRef.current !== generation) return;
            console.warn('Unable to restore the sample clinician workspace:', error);
            forgetClinicianDemoWorkspace();
            deactivateClinicianDemoWorkspace();
            demoTransitionRef.current = null;
          }
        }

        deactivateClinicianDemoWorkspace();
        // Nothing reads Firestore for this account until the persistent cache
        // is known to be its own or empty: hide the previous identity, then
        // let the cache lifecycle clear another account's data first.
        identityRef.current = null;
        setUser(null);
        setRole(null);
        if (currentUser) setLoading(true);
        const preparation = await firestoreCache.prepareForUser(currentUser?.uid ?? null);
        if (!isMounted || !mountedRef.current || authGenerationRef.current !== generation) return;
        // Not ready: the page is reloading, a sign-out is completing (a new
        // auth event follows) or the cache could not be cleared. Stay on the
        // loading screen, which explains the last two.
        if (preparation.status !== 'ready') {
          // The account changed under this tab: a pending invitation belonged
          // to the previous sign-in (App drops it on an account change, but
          // the reload starts App afresh).
          if (preparation.status === 'reloading') clearPendingInvitation();
          if (preparation.status !== 'ending') setLoading(true);
          return;
        }

        identityRef.current = currentUser ? { kind: 'production', uid: currentUser.uid } : null;
        setUser(currentUser);
        setRole(null);

        if (currentUser) {
          setLoading(true);
          const userRole = await fetchUserRole(currentUser.uid);
          if (!isCurrentProductionIdentity(generation, currentUser.uid)) return;
          setRole(userRole);
        }

        if (isMounted && mountedRef.current && authGenerationRef.current === generation) {
          setLoading(false);
        }
      },
      (error) => {
        console.warn('Auth state change listener notice:', error);
        if (demoTransitionRef.current || isClinicianDemoWorkspace()) return;
        if (isMounted) {
          ++authGenerationRef.current;
          demoTransitionRef.current = null;
          identityRef.current = null;
          deactivateClinicianDemoWorkspace();
          setUser(null);
          setRole(null);
          setLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      mountedRef.current = false;
      ++authGenerationRef.current;
      unsubscribe();
    };
  }, []);

  const signup = async (email: string, pass: string, displayName?: string) => {
    forgetClinicianDemoWorkspace();
    deactivateClinicianDemoWorkspace();
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);

    // Set displayName on the Firebase Auth profile
    if (displayName?.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim() }).catch((err) => {
        console.warn('Failed to set display name:', err);
      });
    }

    // The new account writes only once the cache is its own (a previous
    // account's data is cleared first).
    if ((await firestoreCache.prepareForUser(cred.user.uid)).status !== 'ready') return;
    setUser(cred.user);
    setRole(null);

    try {
      await setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        displayName: displayName?.trim() || null,
        createdAt: new Date().toISOString(),
        role: null,
      });
    } catch (err) {
      console.warn('Failed to initialize user document:', err);
    }
  };

  const login = async (email: string, pass: string) => {
    const generation = ++authGenerationRef.current;
    demoTransitionRef.current = null;
    identityRef.current = null;
    forgetClinicianDemoWorkspace();
    deactivateClinicianDemoWorkspace();
    setUser(null);
    setRole(null);
    try {
      // onAuthStateChanged is the single owner of identity/role hydration. A
      // second fetch here could finish after a newer account transition.
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (error) {
      if (mountedRef.current && authGenerationRef.current === generation) setLoading(false);
      throw error;
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!user || !user.email) {
      throw new Error('A signed-in email account is required to change your password.');
    }
    if (isClinicianDemoWorkspace()) {
      throw new Error('Password changes are not available for the demo account.');
    }

    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  };

  const requestPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const loginAsDemoClinician = async () => {
    if (!CLINICIAN_DEMO_AVAILABLE) {
      throw new Error('The sample clinician workspace is not available in this deployment');
    }
    const generation = ++authGenerationRef.current;
    demoTransitionRef.current = 'entering';
    identityRef.current = null;
    setLoading(true);
    setUser(null);
    setRole(null);
    forgetClinicianDemoWorkspace();
    deactivateClinicianDemoWorkspace();
    try {
      await signOut(auth);
      if (!mountedRef.current || authGenerationRef.current !== generation || demoTransitionRef.current !== 'entering') return;
      // No signed-in account's cached data stays behind the demo workspace.
      if ((await firestoreCache.prepareForUser(null)).status !== 'ready') return;
      if (!mountedRef.current || authGenerationRef.current !== generation || demoTransitionRef.current !== 'entering') return;
      try {
        activateClinicianDemoWorkspace();
        rememberClinicianDemoWorkspace();
        identityRef.current = { kind: 'demo' };
        setUser(DEMO_CLINICIAN_USER);
        setRole('clinician');
      } catch (error) {
        deactivateClinicianDemoWorkspace();
        forgetClinicianDemoWorkspace();
        setUser(null);
        setRole(null);
        throw error;
      }
    } finally {
      if (mountedRef.current && authGenerationRef.current === generation && demoTransitionRef.current === 'entering') {
        demoTransitionRef.current = null;
        setLoading(false);
      }
    }
  };

  const selectRole = async (newRole: UserRole) => {
    if (!user) return;
    const generation = authGenerationRef.current;
    const uid = user.uid;
    setRole(newRole);
    if (!isClinicianDemoWorkspace()) {
      // Accounts created while Firestore was temporarily unavailable may not
      // have their profile document yet. A merge write both recovers those
      // accounts and keeps existing profile fields intact.
      try {
        await setDoc(doc(db, 'users', user.uid), {
          role: newRole,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      } catch (err) {
        console.warn('Background role update notice:', err);
        if (isCurrentProductionIdentity(generation, uid)) setRole(null);
        throw err;
      }
    }
  };

  const logout = async ({ discardUnsyncedWrites = false }: { discardUnsyncedWrites?: boolean } = {}): Promise<LogoutOutcome> => {
    // Queued writes are lost when the cache is cleared: give them a moment to
    // upload, and let the user decide if some remain (usually offline). The
    // in-memory demo workspace has no Firebase account and no queued writes.
    if (!discardUnsyncedWrites && !isClinicianDemoWorkspace() && auth.currentUser && await firestoreCache.hasUnsyncedWrites()) {
      return 'unsynced';
    }
    ++authGenerationRef.current;
    clearPendingInvitation();
    demoTransitionRef.current = null;
    identityRef.current = null;
    forgetClinicianDemoWorkspace();
    deactivateClinicianDemoWorkspace();
    setUser(null);
    setRole(null);
    setLoading(true);
    // Signs out (bounded), clears the cache and loads the app afresh. If the
    // cleanup cannot finish, the user is still signed out and the next start
    // finishes it before anything uses Firestore.
    await firestoreCache.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    return 'signed-out';
  };

  const demoWorkspace = isClinicianDemoWorkspace();
  const cacheStatus = useSyncExternalStore(firestoreCache.subscribe, firestoreCache.getStatus, firestoreCache.getStatus);

  return (
    <AuthContext.Provider value={{ user, role, loading, login, signup, changePassword, requestPasswordReset, selectRole, loginAsDemoClinician, logout, cacheStatus, isDemoWorkspace: demoWorkspace }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
