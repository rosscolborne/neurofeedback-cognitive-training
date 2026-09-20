import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { auth, db } from '../services/firebase';
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

interface AuthContextType {
  user: User | null;
  role: UserRole;
  loading: boolean;
  isDemoWorkspace: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (email: string, pass: string, displayName?: string) => Promise<void>;
  selectRole: (role: UserRole) => Promise<void>;
  loginAsDemoClinician: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  isDemoWorkspace: false,
  login: async () => {},
  signup: async () => {},
  selectRole: async () => {},
  loginAsDemoClinician: async () => {},
  logout: async () => {},
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

        const generation = ++authGenerationRef.current;
        if (isClinicianDemoRestoreRequested()) {
          demoTransitionRef.current = 'restoring';
          try {
            if (currentUser) await signOut(auth);
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
    setLoading(true);
    try {
      // onAuthStateChanged is the single owner of identity/role hydration. A
      // second fetch here could finish after a newer account transition.
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (error) {
      if (mountedRef.current && authGenerationRef.current === generation) setLoading(false);
      throw error;
    }
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

  const logout = async () => {
    ++authGenerationRef.current;
    demoTransitionRef.current = null;
    identityRef.current = null;
    forgetClinicianDemoWorkspace();
    deactivateClinicianDemoWorkspace();
    setUser(null);
    setRole(null);
    setLoading(false);
    await signOut(auth).catch(() => {});
  };

  const demoWorkspace = isClinicianDemoWorkspace();

  return (
    <AuthContext.Provider value={{ user, role, loading, login, signup, selectRole, loginAsDemoClinician, logout, isDemoWorkspace: demoWorkspace }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
