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
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

export type UserRole = 'patient' | 'clinician' | null;

interface AuthContextType {
  user: User | null;
  role: UserRole;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (email: string, pass: string, displayName?: string) => Promise<void>;
  selectRole: (role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  login: async () => {},
  signup: async () => {},
  selectRole: async () => {},
  logout: async () => {},
});

// Non-blocking Firestore role fetcher with 800ms limit
const fetchUserRoleWithTimeout = async (uid: string): Promise<UserRole> => {
  try {
    const fetchPromise = getDoc(doc(db, 'users', uid));
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 800));
    const result = await Promise.race([fetchPromise, timeoutPromise]);
    if (result && 'exists' in result && result.exists()) {
      return (result.data()?.role as UserRole) || null;
    }
  } catch (err) {
    console.warn('Non-blocking role fetch error:', err);
  }
  return null;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const safetyTimer = setTimeout(() => {
      if (isMounted) setLoading(false);
    }, 250);

    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!isMounted) return;
        setUser(currentUser);

        if (currentUser) {
          const userRole = await fetchUserRoleWithTimeout(currentUser.uid);
          if (isMounted) setRole(userRole);
        } else {
          if (isMounted) setRole(null);
        }

        if (isMounted) {
          clearTimeout(safetyTimer);
          setLoading(false);
        }
      },
      (error) => {
        console.warn('Auth state change listener notice:', error);
        if (isMounted) {
          clearTimeout(safetyTimer);
          setLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, []);

  const signup = async (email: string, pass: string, displayName?: string) => {
    const authPromise = createUserWithEmailAndPassword(auth, email.trim(), pass);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Sign up timed out. Please check your network connection.')), 7000)
    );
    const cred = await Promise.race([authPromise, timeoutPromise]);

    // Set displayName on the Firebase Auth profile
    if (displayName?.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim() }).catch((err) => {
        console.warn('Failed to set display name:', err);
      });
    }

    setUser(cred.user);
    setRole(null);

    setDoc(doc(db, 'users', cred.user.uid), {
      email: cred.user.email,
      displayName: displayName?.trim() || null,
      createdAt: new Date().toISOString(),
      role: null,
    }).catch((err) => {
      console.warn('Background user record creation notice:', err);
    });
  };

  const login = async (email: string, pass: string) => {
    const authPromise = signInWithEmailAndPassword(auth, email.trim(), pass);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Login timed out. Please check your network connection.')), 7000)
    );
    const cred = await Promise.race([authPromise, timeoutPromise]);
    setUser(cred.user);
    const userRole = await fetchUserRoleWithTimeout(cred.user.uid);
    setRole(userRole);
  };

  const selectRole = async (newRole: UserRole) => {
    if (!user) return;
    setRole(newRole);
    updateDoc(doc(db, 'users', user.uid), {
      role: newRole,
      updatedAt: new Date().toISOString(),
    }).catch((err) => {
      console.warn('Background role update notice:', err);
    });
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, login, signup, selectRole, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
