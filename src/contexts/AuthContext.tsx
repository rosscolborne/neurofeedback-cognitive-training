import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  EmailAuthProvider,
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import { auth, db, firestoreCache } from '../services/firebase';
import type { CacheEndReason, CacheStatus } from '../services/firestoreCacheLifecycle';
import { clearPendingInvitation } from '../services/pendingInvitation';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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
  login: (email: string, pass: string) => Promise<void>;
  signup: (email: string, pass: string, displayName?: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  selectRole: (role: UserRole) => Promise<void>;
  /**
   * Signs out and clears this device's Firestore cache, then reloads the app.
   * Unless `discardUnsyncedWrites` is set, it first waits briefly for queued
   * writes to upload and returns `unsynced` (doing nothing) if some remain.
   */
  logout: (options?: { discardUnsyncedWrites?: boolean }) => Promise<LogoutOutcome>;
  /**
   * The signed-in account's role could not be read: the read failed, or had
   * no answer within `ROLE_LOOKUP_RETRY_AFTER_MS`. `loading` stays true,
   * because an unknown role is not the same as having none.
   */
  roleLookupFailed: boolean;
  /** Reads the signed-in account's role again after `roleLookupFailed`. */
  retryRoleLookup: () => void;
  /** The Firestore cache lifecycle's state, for the loading screen. */
  cacheStatus: CacheStatus;
  /** Why the session is ending, while `cacheStatus` is `ending`. */
  cacheEndingReason: CacheEndReason | null;
  /**
   * Signs out without touching Firestore and loads the app afresh: the way
   * out while the cache cannot be cleared yet (`blocked` or `failed`).
   */
  signOutWithoutFirestore: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  login: async () => {},
  signup: async () => {},
  changePassword: async () => {},
  requestPasswordReset: async () => {},
  selectRole: async () => {},
  logout: async () => 'signed-out',
  roleLookupFailed: false,
  retryRoleLookup: () => {},
  cacheStatus: 'idle',
  cacheEndingReason: null,
  signOutWithoutFirestore: async () => {},
});

/**
 * How long a role read may run before the loading screen offers a retry. It
 * is longer than the Firestore SDK's own offline detection (about 10 s), so a
 * device without a connection first gets the role from its persistent cache.
 * The read keeps running after it, and a late answer still opens the app.
 */
export const ROLE_LOOKUP_RETRY_AFTER_MS = 15_000;

/**
 * After a transient failure (offline, or only the device cache answered), the
 * lookup retries by itself, first after this delay and then backing off to
 * ROLE_LOOKUP_AUTO_RETRY_MAX_MS, so a brief loss of connection right after
 * sign-up or at launch does not leave the account waiting for a tap. Try
 * again still retries at once. A denied read does not retry by itself.
 */
export const ROLE_LOOKUP_AUTO_RETRY_MS = 2_000;
export const ROLE_LOOKUP_AUTO_RETRY_MAX_MS = 10_000;
const TRANSIENT_ROLE_READ_CODES = new Set(['unavailable', 'deadline-exceeded']);

/**
 * Reads the account's role from `users/{uid}`. Resolves `null` only when the
 * server confirms that the account has no role. Rejects when the role is
 * unknown: the read failed (offline with nothing cached, getDoc rejects with
 * `unavailable`), or only this device's cache answered and shows no role,
 * which may predate a role chosen since.
 */
const readUserRole = async (uid: string): Promise<UserRole> => {
  const snap = await getDoc(doc(db, 'users', uid));
  const role = snap.exists() ? (snap.data()?.role as UserRole) || null : null;
  if (role === null && snap.metadata.fromCache) {
    throw Object.assign(new Error('Only the device cache answered, and it shows no role.'), { code: 'unavailable' });
  }
  return role;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);
  const [roleLookupFailed, setRoleLookupFailed] = useState(false);
  const authGenerationRef = useRef(0);
  const roleLookupRef = useRef(0);
  const mountedRef = useRef(true);
  // The uid of the account whose role is being read or shown.
  const identityRef = useRef<string | null>(null);

  const isCurrentIdentity = (generation: number, uid: string) => (
    mountedRef.current
    && authGenerationRef.current === generation
    && identityRef.current === uid
  );

  // Only a read that establishes the role ends loading; until then the app
  // stays on the loading screen and never routes to role selection. A failed
  // or slow read offers a retry there instead; a transient failure also
  // retries by itself (`attempt` counts those retries, and keeps the retry
  // screen up between them).
  const lookUpRole = async (generation: number, uid: string, attempt = 0, lastErrorCode?: string) => {
    const lookup = ++roleLookupRef.current;
    const isCurrent = () => roleLookupRef.current === lookup && isCurrentIdentity(generation, uid);
    if (attempt === 0) setRoleLookupFailed(false);
    setLoading(true);
    const slow = setTimeout(() => { if (isCurrent()) setRoleLookupFailed(true); }, ROLE_LOOKUP_RETRY_AFTER_MS);
    try {
      const userRole = await readUserRole(uid);
      if (!isCurrent()) return;
      setRole(userRole);
      setRoleLookupFailed(false);
      setLoading(false);
    } catch (error) {
      if (!isCurrent()) return;
      const code = String((error as { code?: unknown } | null)?.code);
      // Once per kind of failure, not on every automatic retry.
      if (attempt === 0 || code !== lastErrorCode) console.warn('Could not read the account role:', error);
      setRoleLookupFailed(true);
      if (TRANSIENT_ROLE_READ_CODES.has(code)) {
        // A newer lookup (Try again), a sign-out or an account switch makes this stale.
        const delay = Math.min(ROLE_LOOKUP_AUTO_RETRY_MS * 2 ** attempt, ROLE_LOOKUP_AUTO_RETRY_MAX_MS);
        setTimeout(() => { if (isCurrent()) void lookUpRole(generation, uid, attempt + 1, code); }, delay);
      }
    } finally {
      clearTimeout(slow);
    }
  };

  useEffect(() => {
    let isMounted = true;
    mountedRef.current = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!isMounted || !mountedRef.current) return;

        // An explicit sign-out or account deletion owns the screen until the
        // page navigates away; its own auth events are not account changes.
        if (firestoreCache.isEnding()) return;

        const generation = ++authGenerationRef.current;
        // Nothing reads Firestore for this account until the persistent cache
        // is known to be its own or empty: hide the previous identity, then
        // let the cache lifecycle clear another account's data first.
        identityRef.current = null;
        setUser(null);
        setRole(null);
        setRoleLookupFailed(false);
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

        identityRef.current = currentUser?.uid ?? null;
        setUser(currentUser);
        setRole(null);

        if (currentUser) {
          await lookUpRole(generation, currentUser.uid);
          return;
        }

        if (isMounted && mountedRef.current && authGenerationRef.current === generation) {
          setLoading(false);
        }
      },
      (error) => {
        console.warn('Auth state change listener notice:', error);
        if (isMounted) {
          ++authGenerationRef.current;
          identityRef.current = null;
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
    identityRef.current = null;
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
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  };

  const requestPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const selectRole = async (newRole: UserRole) => {
    if (!user) return;
    const generation = authGenerationRef.current;
    const uid = user.uid;
    setRole(newRole);
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
      if (isCurrentIdentity(generation, uid)) setRole(null);
      throw err;
    }
  };

  const logout = async ({ discardUnsyncedWrites = false }: { discardUnsyncedWrites?: boolean } = {}): Promise<LogoutOutcome> => {
    // Queued writes are lost when the cache is cleared: give them a moment to
    // upload, and let the user decide if some remain (usually offline).
    if (!discardUnsyncedWrites && auth.currentUser && await firestoreCache.hasUnsyncedWrites()) {
      return 'unsynced';
    }
    ++authGenerationRef.current;
    clearPendingInvitation();
    identityRef.current = null;
    setUser(null);
    setRole(null);
    setLoading(true);
    // Signs out (bounded), clears the cache and loads the app afresh. If the
    // cleanup cannot finish, the user is still signed out and the next start
    // finishes it before anything uses Firestore.
    await firestoreCache.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    return 'signed-out';
  };

  const retryRoleLookup = () => {
    const uid = identityRef.current;
    if (!uid) return;
    void lookUpRole(authGenerationRef.current, uid);
  };

  const cacheStatus = useSyncExternalStore(firestoreCache.subscribe, firestoreCache.getStatus, firestoreCache.getStatus);
  // Read in the same render as the status change that accompanies it.
  const cacheEndingReason = cacheStatus === 'ending' ? firestoreCache.getEndingReason() : null;

  const signOutWithoutFirestore = async () => {
    ++authGenerationRef.current;
    clearPendingInvitation();
    identityRef.current = null;
    setUser(null);
    setRole(null);
    setLoading(true);
    await firestoreCache.signOutWithoutFirestore();
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, login, signup, changePassword, requestPasswordReset, selectRole, logout, roleLookupFailed, retryRoleLookup, cacheStatus, cacheEndingReason, signOutWithoutFirestore }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
