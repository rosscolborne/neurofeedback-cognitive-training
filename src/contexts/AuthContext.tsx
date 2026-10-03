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
} from 'firebase/auth';
import type { UserProfile } from '@nfct/shared';
import { auth, firestoreCache } from '../services/firebase';
import type { CacheEndReason, CacheStatus } from '../services/firestoreCacheLifecycle';
import { profileRepository, type UserProfilePatch } from '../consumer/repositories';
import { newProfileDraft } from '../consumer/profile/newProfile';

/**
 * `unsynced`: the signed-in user has writes the server has not accepted yet,
 * so nothing was done; ask before calling `logout({ discardUnsyncedWrites: true })`.
 */
export type LogoutOutcome = 'signed-out' | 'unsynced';

interface AuthContextType {
  user: User | null;
  /**
   * The signed-in player's profile (users/{uid}). Null while signed out and
   * until it has been read, or created for a player who has none.
   */
  profile: UserProfile | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (email: string, pass: string, displayName?: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  /**
   * Saves a change to the signed-in player's profile. Resolves once the server
   * has accepted it, after which `profile` includes it; rejects if the write
   * is refused.
   */
  updateProfile: (patch: UserProfilePatch) => Promise<void>;
  /**
   * Signs out and clears this device's Firestore cache, then reloads the app.
   * Unless `discardUnsyncedWrites` is set, it first waits briefly for queued
   * writes to upload and returns `unsynced` (doing nothing) if some remain.
   */
  logout: (options?: { discardUnsyncedWrites?: boolean }) => Promise<LogoutOutcome>;
  /**
   * The signed-in player's profile could not be loaded: the read failed, had
   * no answer within `PROFILE_LOOKUP_RETRY_AFTER_MS`, or found a document this
   * app cannot read, or creating a missing profile failed. `loading` stays
   * true, because an unknown profile is not the same as having none.
   */
  profileLookupFailed: boolean;
  /** Loads the signed-in player's profile again after `profileLookupFailed`. */
  retryProfileLookup: () => void;
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
  profile: null,
  loading: true,
  login: async () => {},
  signup: async () => {},
  changePassword: async () => {},
  requestPasswordReset: async () => {},
  updateProfile: async () => {},
  logout: async () => 'signed-out',
  profileLookupFailed: false,
  retryProfileLookup: () => {},
  cacheStatus: 'idle',
  cacheEndingReason: null,
  signOutWithoutFirestore: async () => {},
});

/**
 * How long a profile lookup may run before the loading screen offers a retry.
 * It is longer than the Firestore SDK's own offline detection (about 10 s), so
 * a device without a connection first gets the profile from its persistent
 * cache. The lookup keeps running after it, and a late answer still opens the app.
 */
export const PROFILE_LOOKUP_RETRY_AFTER_MS = 15_000;

/**
 * After a transient failure (offline, or only the device cache answered), the
 * lookup retries by itself, first after this delay and then backing off to
 * PROFILE_LOOKUP_AUTO_RETRY_MAX_MS, so a brief loss of connection right after
 * sign-up or at launch does not leave the player waiting for a tap. Try again
 * still retries at once. Other failures do not retry by itself.
 */
export const PROFILE_LOOKUP_AUTO_RETRY_MS = 2_000;
export const PROFILE_LOOKUP_AUTO_RETRY_MAX_MS = 10_000;
const TRANSIENT_PROFILE_READ_CODES = new Set(['unavailable', 'deadline-exceeded']);

const lookupError = (message: string, code: string) => Object.assign(new Error(message), { code });

/** The name typed at sign-up, kept until that account's profile has been created. */
interface SignupDraft {
  email: string;
  displayName: string | null;
}

const normalizedEmail = (email: string | null | undefined) => (email ?? '').trim().toLowerCase();

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLookupFailed, setProfileLookupFailed] = useState(false);
  const authGenerationRef = useRef(0);
  const profileLookupRef = useRef(0);
  const mountedRef = useRef(true);
  // The uid of the account whose profile is being read or shown.
  const identityRef = useRef<string | null>(null);
  const signupDraftRef = useRef<SignupDraft | null>(null);

  const isCurrentIdentity = (generation: number, uid: string) => (
    mountedRef.current
    && authGenerationRef.current === generation
    && identityRef.current === uid
  );

  /**
   * The signed-in player's profile, read through the consumer repository.
   * Resolves only with a profile the server has confirmed, or this device's
   * own queued write of it. When the server confirms there is none (right
   * after sign-up, or if that write never landed), it creates one and waits
   * for the server to accept it, so a refused write is never silent.
   * Rejects while the profile is unknown or cannot be used. Returns null once
   * the lookup is stale.
   */
  const readOrCreateProfile = async (uid: string, isCurrent: () => boolean): Promise<UserProfile | null> => {
    const read = await profileRepository.getProfile();
    if (!isCurrent()) return null;
    if (read.status === 'readable') return read.data;
    if (read.status === 'unreadable') throw lookupError('The profile document cannot be read by this app.', 'unreadable-profile');
    // A cache-only answer may predate a profile created since on another device.
    if (read.fromCache) throw lookupError('Only the device cache answered, and it has no profile.', 'unavailable');

    const currentUser = auth.currentUser;
    if (currentUser?.uid !== uid) return null;
    const draft = signupDraftRef.current;
    const typedName = draft && draft.email === normalizedEmail(currentUser.email) ? draft.displayName : currentUser.displayName;
    await profileRepository.createProfile(newProfileDraft(typedName)).acknowledged;
    if (!isCurrent()) return null;
    if (signupDraftRef.current === draft) signupDraftRef.current = null;
    const created = await profileRepository.getProfile();
    if (!isCurrent()) return null;
    if (created.status !== 'readable') throw lookupError('The new profile could not be read back.', 'unreadable-profile');
    return created.data;
  };

  // Only a lookup that establishes the profile ends loading; until then the
  // app stays on the loading screen. A failed or slow lookup offers a retry
  // there instead; a transient failure also retries by itself (`attempt`
  // counts those retries, and keeps the retry screen up between them).
  const lookUpProfile = async (generation: number, uid: string, attempt = 0, lastErrorCode?: string) => {
    const lookup = ++profileLookupRef.current;
    const isCurrent = () => profileLookupRef.current === lookup && isCurrentIdentity(generation, uid);
    if (attempt === 0) setProfileLookupFailed(false);
    setLoading(true);
    const slow = setTimeout(() => { if (isCurrent()) setProfileLookupFailed(true); }, PROFILE_LOOKUP_RETRY_AFTER_MS);
    try {
      const loaded = await readOrCreateProfile(uid, isCurrent);
      if (!loaded || !isCurrent()) return;
      setProfile(loaded);
      setProfileLookupFailed(false);
      setLoading(false);
    } catch (error) {
      if (!isCurrent()) return;
      const code = String((error as { code?: unknown } | null)?.code);
      // Once per kind of failure, not on every automatic retry.
      if (attempt === 0 || code !== lastErrorCode) console.warn('Could not load the player profile:', error);
      setProfileLookupFailed(true);
      if (TRANSIENT_PROFILE_READ_CODES.has(code)) {
        // A newer lookup (Try again), a sign-out or an account switch makes this stale.
        const delay = Math.min(PROFILE_LOOKUP_AUTO_RETRY_MS * 2 ** attempt, PROFILE_LOOKUP_AUTO_RETRY_MAX_MS);
        setTimeout(() => { if (isCurrent()) void lookUpProfile(generation, uid, attempt + 1, code); }, delay);
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
        setProfile(null);
        setProfileLookupFailed(false);
        if (currentUser) setLoading(true);
        const preparation = await firestoreCache.prepareForUser(currentUser?.uid ?? null);
        if (!isMounted || !mountedRef.current || authGenerationRef.current !== generation) return;
        // Not ready: the page is reloading, a sign-out is completing (a new
        // auth event follows) or the cache could not be cleared. Stay on the
        // loading screen, which explains the last two.
        if (preparation.status !== 'ready') {
          if (preparation.status !== 'ending') setLoading(true);
          return;
        }

        identityRef.current = currentUser?.uid ?? null;
        setUser(currentUser);
        setProfile(null);

        if (currentUser) {
          await lookUpProfile(generation, currentUser.uid);
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
          setProfile(null);
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
    // Creating the account fires the auth listener, which creates the profile
    // with the typed name once this device's cache is the new account's own.
    signupDraftRef.current = { email: normalizedEmail(email), displayName: displayName ?? null };
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), pass);
    } catch (error) {
      signupDraftRef.current = null;
      throw error;
    }
  };

  const login = async (email: string, pass: string) => {
    const generation = ++authGenerationRef.current;
    identityRef.current = null;
    setUser(null);
    setProfile(null);
    try {
      // onAuthStateChanged is the single owner of identity/profile hydration.
      // A second read here could finish after a newer account transition.
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

  const updateProfile = async (patch: UserProfilePatch) => {
    const generation = authGenerationRef.current;
    const uid = identityRef.current;
    if (!uid || auth.currentUser?.uid !== uid) throw new Error('Sign in to change your profile.');
    await profileRepository.updateProfile(patch).acknowledged;
    if (!isCurrentIdentity(generation, uid)) return;
    const read = await profileRepository.getProfile();
    if (isCurrentIdentity(generation, uid) && read.status === 'readable') setProfile(read.data);
  };

  const logout = async ({ discardUnsyncedWrites = false }: { discardUnsyncedWrites?: boolean } = {}): Promise<LogoutOutcome> => {
    // Queued writes are lost when the cache is cleared: give them a moment to
    // upload, and let the user decide if some remain (usually offline).
    if (!discardUnsyncedWrites && auth.currentUser && await firestoreCache.hasUnsyncedWrites()) {
      return 'unsynced';
    }
    ++authGenerationRef.current;
    identityRef.current = null;
    signupDraftRef.current = null;
    setUser(null);
    setProfile(null);
    setLoading(true);
    // Signs out (bounded), clears the cache and loads the app afresh. If the
    // cleanup cannot finish, the user is still signed out and the next start
    // finishes it before anything uses Firestore.
    await firestoreCache.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    return 'signed-out';
  };

  const retryProfileLookup = () => {
    const uid = identityRef.current;
    if (!uid) return;
    void lookUpProfile(authGenerationRef.current, uid);
  };

  const cacheStatus = useSyncExternalStore(firestoreCache.subscribe, firestoreCache.getStatus, firestoreCache.getStatus);
  // Read in the same render as the status change that accompanies it.
  const cacheEndingReason = cacheStatus === 'ending' ? firestoreCache.getEndingReason() : null;

  const signOutWithoutFirestore = async () => {
    ++authGenerationRef.current;
    identityRef.current = null;
    signupDraftRef.current = null;
    setUser(null);
    setProfile(null);
    setLoading(true);
    await firestoreCache.signOutWithoutFirestore();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, signup, changePassword, requestPasswordReset, updateProfile, logout, profileLookupFailed, retryProfileLookup, cacheStatus, cacheEndingReason, signOutWithoutFirestore }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
