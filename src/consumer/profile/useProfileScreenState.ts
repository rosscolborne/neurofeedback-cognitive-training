import type React from 'react';
import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { auth } from '../../services/firebase';
import { useSignOut } from '../../components/account/useSignOut';
import { useAccountDeletion } from '../../components/account/useAccountDeletion';
import { ProfilePhotoError, profilePhotoFromFile } from './profilePhoto';

/**
 * Profile's work in progress: a photo being saved, an account deletion, and
 * signing out. The app shell holds it, because it must outlive the Profile
 * tab: a player who leaves Profile, or opens a game, while one is running
 * finds it, or its error, still there when they come back.
 */
export function useProfileScreenState(playerId: string) {
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  // A processed photo whose save failed, kept so Retry sends the same photo.
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  // Sign-out clears this device's Firestore cache and reloads the app; it asks
  // first if some activity has not uploaded yet (AuthContext.logout).
  const { logout, updateProfile } = useAuth();
  const signOutFlow = useSignOut(logout);
  const deletion = useAccountDeletion(playerId);

  const saveProfilePhoto = async (dataUrl: string) => {
    setIsSavingProfile(true);
    setProfileSaveError(null);
    try {
      // The photo belongs to this shell's player; never save it to another signed-in account.
      if (auth.currentUser?.uid !== playerId) throw new Error('The signed-in account changed.');
      await updateProfile({ avatar: { kind: 'photo', dataUrl } });
      setPendingPhoto(null);
    } catch (error) {
      console.warn('Could not save the profile photo:', error);
      setPendingPhoto(dataUrl);
      setProfileSaveError('The profile photo couldn’t be saved. Check your connection, then retry.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePhotoChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Choosing the same file again must still fire a change.
    event.target.value = '';
    if (!file || isSavingProfile) return;
    let dataUrl: string;
    setIsSavingProfile(true);
    setProfileSaveError(null);
    setPendingPhoto(null);
    try {
      dataUrl = await profilePhotoFromFile(file);
    } catch (error) {
      setProfileSaveError(error instanceof ProfilePhotoError ? error.message : 'This photo couldn’t be used. Choose a different photo.');
      setIsSavingProfile(false);
      return;
    }
    await saveProfilePhoto(dataUrl);
  };

  return { isSavingProfile, profileSaveError, pendingPhoto, saveProfilePhoto, handlePhotoChosen, signOutFlow, deletion };
}

export type ProfileScreenState = ReturnType<typeof useProfileScreenState>;
