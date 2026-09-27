import { UserRound } from 'lucide-react';

interface PatientAvatarProps {
  avatarUrl?: string;
  size: number;
}

/** The patient profile uploader stores photos as data URLs; legacy stock URLs are not patient photos. */
export function PatientAvatar({ avatarUrl, size }: PatientAvatarProps) {
  const uploadedPhoto = avatarUrl?.startsWith('data:image/') || avatarUrl?.startsWith('blob:') ? avatarUrl : null;

  return <span className="patient-avatar" style={{ width: size, height: size }} aria-hidden="true">
    {uploadedPhoto
      ? <img src={uploadedPhoto} alt="" />
      : <UserRound size={Math.round(size * 0.58)} strokeWidth={1.8} />}
  </span>;
}
