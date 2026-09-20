import React, { createContext, useContext, useEffect, useState } from 'react';
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

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!isMounted) return;
        if (isClinicianDemoRestoreRequested()) {
          try {
            if (currentUser) await signOut(auth);
            if (!isMounted) return;
            activateClinicianDemoWorkspace();
            setUser(DEMO_CLINICIAN_USER);
            setRole('clinician');
            setLoading(false);
            return;
          } catch (error) {
            console.warn('Unable to restore the sample clinician workspace:', error);
            forgetClinicianDemoWorkspace();
            deactivateClinicianDemoWorkspace();
          }
        }

        deactivateClinicianDemoWorkspace();
        setUser(currentUser);

        if (currentUser) {
          const userRole = await fetchUserRole(currentUser.uid);
          if (isMounted) setRole(userRole);
        } else {
          if (isMounted) setRole(null);
        }

        if (isMounted) {
          setLoading(false);
        }
      },
      (error) => {
        console.warn('Auth state change listener notice:', error);
        if (isMounted) {
          deactivateClinicianDemoWorkspace();
          setLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
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
    forgetClinicianDemoWorkspace();
    deactivateClinicianDemoWorkspace();
    const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
    setUser(cred.user);
    const userRole = await fetchUserRole(cred.user.uid);
    setRole(userRole);
  };

  const loginAsDemoClinician = async () => {
    if (!CLINICIAN_DEMO_AVAILABLE) {
      throw new Error('The sample clinician workspace is not available in this deployment');
    }
    setLoading(true);
    forgetClinicianDemoWorkspace();
    deactivateClinicianDemoWorkspace();
    try {
      await signOut(auth);
      activateClinicianDemoWorkspace();
      rememberClinicianDemoWorkspace();
      setUser(DEMO_CLINICIAN_USER);
      setRole('clinician');
    } finally {
      setLoading(false);
    }
  };

  const selectRole = async (newRole: UserRole) => {
    if (!user) return;
    setRole(newRole);
    if (user.uid !== DEMO_CLINICIAN_ID) {
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
        setRole(null);
        throw err;
      }
    }
  };

  const logout = async () => {
    forgetClinicianDemoWorkspace();
    deactivateClinicianDemoWorkspace();
    await signOut(auth).catch(() => {});
    setUser(null);
    setRole(null);
  };

  const demoWorkspace = isClinicianDemoWorkspace() && user?.uid === DEMO_CLINICIAN_ID;

  return (
    <AuthContext.Provider value={{ user, role, loading, login, signup, selectRole, loginAsDemoClinician, logout, isDemoWorkspace: demoWorkspace }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
