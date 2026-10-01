import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, firestoreCache } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useSignOut } from '../account/useSignOut';
import { ClientProfile, ClinicBrandConfig, ExperienceType, IndividualBaselineModel, SessionRecord } from '../../types';
import { getCalibrationDisplayState } from '../../services/dataMappers';
import { HomeScreen } from './HomeScreen';
import { ProgressHistory } from './ProgressHistory';
import { OnboardingFlow } from './OnboardingFlow';
import { SessionRunner } from './SessionRunner';
import { PostSessionSummary } from './PostSessionSummary';
import { ProtocolDetailsModal } from './ProtocolDetailsModal';
import { SelfDirectedSetupModal } from './SelfDirectedSetupModal';
import { DisconnectClinicianDialog } from './DisconnectClinicianDialog';
import { ChangePasswordForm } from '../account/ChangePasswordForm';
import { getAccountDeletionErrorMessage } from '../account/accountDeletionErrors';
import { PatientMessagingView } from './PatientMessagingView';
import { useMessageUnread } from '../messaging/useMessageUnread';
import { messageRepository } from '../../services/messageRepository';
import { PatientAppointmentsView } from './PatientAppointmentsView';
import { BrandLogo } from '../brand/BrandLogo';
import { Home, Compass, Activity, User, Camera, LogOut, Trash2, FileText, VolumeX, Volume2, MessageSquare, CalendarDays, ChevronRight, ClipboardList, RotateCcw, CheckCircle2, SlidersHorizontal, Unlink } from 'lucide-react';
import { FactGrid, type Fact } from '../ui/FactGrid';
import { canStartAssignedExperience } from './experienceCatalogue';
import { TrainTab } from './TrainTab';
import { storageEngine } from '../../services/storageEngine';
import { audioEngine } from '../../services/audioEngine';
import { protocolDisplayName, resolvePatientProtocol } from '../../services/protocols';
import { clearPendingInvitation } from '../../services/pendingInvitation';
import {
  buildSelfDirectedTrainingSetup,
  ClinicianManagedTrainingError,
  isPatientTabAvailable,
  resolveTrainingAuthority,
  TRAINING_AUTHORITY_LABEL,
  type SelfDirectedTrainingSetup,
} from '../../services/patientTrainingAuthority';
import { exportPatientSessionCsv } from './patientSessionCsv';
import {
  getClinicalProtocolTemplate,
  getProtocolAssignmentAlias,
} from '../../services/clinicalProtocolTemplates';
import { GameScreen } from '../../consumer/games/GameScreen';
import type { GameScreenView } from '../../consumer/games/gameScreens';
import { MentalMathProgressCard } from '../../consumer/games/mentalMath/MentalMathProgressCard';
import { HomeOverview } from '../../consumer/overview/HomeOverview';
import { ProgressOverview } from '../../consumer/overview/ProgressOverview';
import { createDemoModeEegProvider } from '../../services/demoModeEegCapture';
import { APP_DISPLAY_NAME } from '../../config/appIdentity';

// NFCT-21, NFCT-12: games open from the Train tab's catalogue until the
// consumer shell exists (NFCT-6). Demo Mode's synthetic EEG is offered as an
// optional, clearly simulated recording; a game never needs it.
const demoModeEegProvider = createDemoModeEegProvider();

// Same day-month-year style as session history, so dates read alike across Profile and Progress.
const SHORT_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

const IMPRINT_TAG: Record<'valid' | 'expired' | 'invalid' | 'not-calibrated', string> = {
  valid: 'status-tag-active',
  expired: 'status-tag-paused',
  invalid: 'status-tag-alert',
  'not-calibrated': 'status-tag-neutral',
};

interface PatientShellProps {
  brand: ClinicBrandConfig;
  client: ClientProfile;
  onUpdateClient: (updated: ClientProfile) => Promise<void>;
  /** Update local UI for data already persisted by an atomic repository operation. */
  onClientPersistedElsewhere: (updated: ClientProfile) => void;
  onBaselinePersisted?: (patientId: string, model: IndividualBaselineModel) => void;
  onRecalibrate?: () => void;
  onOpenRebrand: () => void;
  initialInvitationCode?: string;
  invitationRouteCode?: string;
  onInvitationAccepted?: () => void;
  onInvitationDismissed?: () => void;
}

export const PatientShell: React.FC<PatientShellProps> = ({
  brand,
  client,
  onUpdateClient,
  onClientPersistedElsewhere,
  onBaselinePersisted,
  onRecalibrate,
  initialInvitationCode,
  invitationRouteCode,
  onInvitationAccepted,
  onInvitationDismissed,
}) => {
  const [requestedTab, setActiveTab] = useState<'home' | 'sessions' | 'progress' | 'messages' | 'appointments' | 'profile'>('home');
  // Home's "See all achievements" opens Progress at its achievements (NFCT-13). The request lasts
  // only for the Progress visit it opened: leaving Progress drops it (see below, after activeTab).
  const [progressFocus, setProgressFocus] = useState<'achievements' | null>(null);
  const [progressFocusTab, setProgressFocusTab] = useState<string>('home');
  const [activeSessionExp, setActiveSessionExp] = useState<ExperienceType | null>(null);
  // The open catalogue game (NFCT-12), and the view it opens on: its start
  // screen, or its progress (NFCT-22's Progress-tab card).
  const [openGame, setOpenGame] = useState<{ gameId: string; ownerId: string; initialView?: GameScreenView } | null>(null);
  const [sessionOwnerId, setSessionOwnerId] = useState<string | null>(null);
  const currentClientId = useRef(client.id);
  const currentAllowedExperiences = useRef(client.allowedExperiences);
  useLayoutEffect(() => { currentAllowedExperiences.current = client.allowedExperiences; }, [client.allowedExperiences]);
  useEffect(() => {
    currentClientId.current = client.id;
  }, [client.id]);
  const [completedSession, setCompletedSession] = useState<SessionRecord | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isMuted, setIsMuted] = useState(audioEngine.getMuted());
  const [exportStatus, setExportStatus] = useState<'idle' | 'done'>('idle');
  const [showClinicianLink, setShowClinicianLink] = useState(!!initialInvitationCode);
  const [invitationCode, setInvitationCode] = useState(initialInvitationCode || '');
  useEffect(() => {
    if (!initialInvitationCode) return;
    setInvitationCode(initialInvitationCode);
    setShowClinicianLink(true);
    setActiveTab('home');
  }, [initialInvitationCode]);
  useEffect(() => {
    if (!invitationRouteCode) return;
    setInvitationCode(invitationRouteCode);
    setShowClinicianLink(true);
    setActiveTab('home');
  }, [invitationRouteCode]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [hasPendingInvitation, setHasPendingInvitation] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [showProtocolDetails, setShowProtocolDetails] = useState(false);
  const [showTrainingSetup, setShowTrainingSetup] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState<string | null>(null);
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const resolvedProtocol = resolvePatientProtocol(client);
  const evidenceProtocol = getClinicalProtocolTemplate(resolvedProtocol);
  const protocolAlias = client.customProtocolConfig
    ? getProtocolAssignmentAlias(client.customProtocolConfig, resolvedProtocol)
    : undefined;
  const imprintState = getCalibrationDisplayState(client.individualBaselineModel);
  const imprintDate = imprintState.calibratedAt == null ? null : new Date(imprintState.calibratedAt).toLocaleDateString(undefined, SHORT_DATE);
  const protocolName = evidenceProtocol?.name ?? protocolDisplayName(resolvedProtocol);
  const imprintLabel = imprintState.status === 'valid' ? 'Current'
    : imprintState.status === 'expired' ? 'Expired'
      : imprintState.status === 'invalid' ? 'Needs recalibration' : 'Not calibrated';
  const measuredAlphaPeakHz = client.individualBaselineModel?.algorithmVersion === 'neurogambit-15s-v1'
    ? undefined : client.individualBaselineModel?.alphaPeakHz;
  const imprintFacts: Fact[] = [
    ...(imprintDate ? [{ label: 'Calibrated', value: <time dateTime={new Date(imprintState.calibratedAt!).toISOString()}>{imprintDate}</time> }] : []),
    ...(imprintState.status === 'valid' && typeof measuredAlphaPeakHz === 'number' && Number.isFinite(measuredAlphaPeakHz)
      ? [{ label: 'Alpha peak', value: `${measuredAlphaPeakHz.toFixed(1)} Hz` }] : []),
    ...(imprintState.expiresAt != null ? [{ label: 'Expires', value: <time dateTime={new Date(imprintState.expiresAt).toISOString()}>{new Date(imprintState.expiresAt).toLocaleDateString(undefined, SHORT_DATE)}</time> }] : []),
  ];
  const trainingAuthority = resolveTrainingAuthority(client);
  const isClinicianLinked = trainingAuthority === 'clinician';
  // Clinician-dependent destinations follow the live relationship; a hidden tab falls back to Home.
  const activeTab = isPatientTabAvailable(requestedTab, trainingAuthority) ? requestedTab : 'home';
  // Any change to a tab other than Progress drops a pending "See all achievements" request, so a later,
  // ordinary visit to Progress opens at the top (state adjusted while rendering, not in an effect).
  if (progressFocusTab !== activeTab) {
    setProgressFocusTab(activeTab);
    if (activeTab !== 'progress' && progressFocus !== null) setProgressFocus(null);
  }
  // Reopening the link for the invitation this patient already accepted is not a conflicting invitation.
  const pendingInvitationAlreadyAccepted = !!initialInvitationCode && !!client.acceptedInvitationId
    && client.acceptedInvitationId.toUpperCase() === initialInvitationCode.toUpperCase();
  useEffect(() => {
    if (isClinicianLinked && pendingInvitationAlreadyAccepted) onInvitationDismissed?.();
  }, [isClinicianLinked, pendingInvitationAlreadyAccepted, onInvitationDismissed]);
  // A self-directed patient learns only whether some clinician has a pending invitation for their
  // email. Rechecked on opening Home or Profile, where Connect is offered, so a new one shows up.
  const showsConnectSurface = activeTab === 'home' || activeTab === 'profile';
  useEffect(() => {
    if (isClinicianLinked || !showsConnectSurface) return;
    let active = true;
    storageEngine.hasPendingInvitationNotice()
      .then((pending) => { if (active) setHasPendingInvitation(pending); })
      .catch(() => { if (active) setHasPendingInvitation(false); });
    return () => { active = false; };
  }, [client.id, isClinicianLinked, showsConnectSurface, activeTab]);
  const messageUnread = useMessageUnread(isClinicianLinked ? [client.id] : [], messageRepository, true, client.clinicianId || client.linkedClinicianCode || '');
  const hasUnreadMessage = messageUnread.byPatient[client.id]?.unread ?? false;

  // Sign-out clears this device's Firestore cache and reloads the app; it asks
  // first if some activity has not uploaded yet (AuthContext.logout).
  const { logout } = useAuth();
  const signOutFlow = useSignOut(logout);
  const handleLogout = signOutFlow.requestSignOut;

  const handleLinkClinician = async () => {
    if (!invitationCode.trim()) return;
    setIsLinking(true);
    setLinkError(null);
    try {
      const linkedClient = await storageEngine.acceptPatientInvitation(invitationCode, client);
      onClientPersistedElsewhere(linkedClient);
      onInvitationAccepted?.();
      setInvitationCode('');
      setShowClinicianLink(false);
      setHasPendingInvitation(false);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Could not accept this invitation.');
    } finally {
      setIsLinking(false);
    }
  };

  const handleDisconnectClinician = async () => {
    const disconnected = await storageEngine.disconnectFromClinician(client.id);
    onClientPersistedElsewhere(disconnected);
    setShowDisconnect(false);
  };

  const handleSaveTrainingSetup = async (setup: SelfDirectedTrainingSetup) => {
    try {
      onClientPersistedElsewhere(await storageEngine.saveSelfDirectedTrainingSetup(client.id, setup));
      setShowTrainingSetup(false);
    } catch (error) {
      // A clinician linked this account elsewhere: show their plan and explain why nothing was saved.
      if (error instanceof ClinicianManagedTrainingError) onClientPersistedElsewhere(error.current);
      throw error;
    }
  };

  const handleDeleteAccount = async () => {
    if (isDeletingAccount || !deletePassword) return;
    // Submitting is the final confirmation. Hand the password to reauthentication
    // and drop it from state so teardown never re-renders it.
    const password = deletePassword;
    setDeletePassword('');
    const user = auth.currentUser;
    if (!user?.email || user.uid !== client.id) {
      setAccountDeletionError('Your signed-in account changed. Restart account deletion.');
      return;
    }
    setIsDeletingAccount(true);
    setAccountDeletionError(null);
    // Publishing the deactivated profile mid-teardown would swap in the resume
    // screen just before the redirect, so it is only published if deletion fails.
    const deactivation: { client?: ClientProfile } = {};
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      if (auth.currentUser !== user || auth.currentUser.uid !== client.id) throw new Error('Your signed-in account changed. Restart account deletion.');
      await storageEngine.preparePatientAccountDeletion(user.uid, (deactivated) => { deactivation.client = deactivated; });
      if (auth.currentUser !== user || auth.currentUser.uid !== client.id) throw new Error('Your signed-in account changed. Restart account deletion.');
      // Deleting the Auth account runs inside the cache cleanup, so its
      // sign-out is not mistaken for an account change. Once it succeeds the
      // deleted account's cached data and queued writes are removed from this
      // device, and the app loads afresh at the welcome screen.
      await firestoreCache.endSession({
        reason: 'account-deleted',
        signOut: false,
        destination: '/welcome',
        before: async () => {
          await user.delete();
          clearPendingInvitation();
        },
      });
    } catch (err) {
      if (deactivation.client) onClientPersistedElsewhere(deactivation.client);
      setAccountDeletionError(getAccountDeletionErrorMessage(err));
      // Only failure leaves the pending state; success keeps it until the redirect lands.
      setIsDeletingAccount(false);
    }
  };

  const openAccountDeletion = () => {
    setAccountDeletionError(null);
    setShowDeletePassword(true);
  };

  const cancelAccountDeletion = () => {
    setShowDeletePassword(false);
    setDeletePassword('');
    setAccountDeletionError(null);
  };

  const deletionPasswordForm = showDeletePassword && (isDeletingAccount ? (
    <div className="account-deletion-confirmation account-deletion-status" role="status" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
      Deleting your account…
    </div>
  ) : (
    <form
      className="account-deletion-confirmation"
      onSubmit={(event) => { event.preventDefault(); void handleDeleteAccount(); }}
    >
      {!client.accountDeletionStartedAt && (
        <p style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
          Are you sure you want to delete your account? This action cannot be undone.
        </p>
      )}
      <label className="account-deletion-label" htmlFor="account-deletion-password">
        Enter your password to confirm account deletion
        <input
          className="account-deletion-password"
          id="account-deletion-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={deletePassword}
          onChange={(event) => setDeletePassword(event.target.value)}
          aria-invalid={!!accountDeletionError}
          aria-describedby={accountDeletionError ? 'account-deletion-error' : undefined}
        />
      </label>
      {accountDeletionError && <p className="account-deletion-error" id="account-deletion-error" role="alert">{accountDeletionError}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px' }}>
        <button className="btn account-deletion-submit" type="submit" disabled={!deletePassword}>
          Confirm account deletion
        </button>
        <button className="btn btn-ghost" type="button" onClick={cancelAccountDeletion} style={{ minHeight: '42px', marginTop: '4px' }}>
          Cancel
        </button>
      </div>
    </form>
  ));

  const handleStartSession = (exp: ExperienceType) => {
    if (currentClientId.current !== client.id || !canStartAssignedExperience(currentAllowedExperiences.current, exp)) return;
    setSessionOwnerId(client.id);
    setActiveSessionExp(exp);
  };

  const handleSessionComplete = async (session: SessionRecord) => {
    await storageEngine.saveSession(session);
    const persistedClient = await storageEngine.getClient(client.id);
    if (!persistedClient) throw new Error('The saved session could not be reloaded. Try again.');
    onClientPersistedElsewhere(persistedClient);
    setActiveSessionExp(null);
    setCompletedSession(session);
  };

  const handleToggleMute = () => {
    const newState = !isMuted;
    audioEngine.setMuted(newState);
    setIsMuted(newState);
  };

  // Connect is offered only with a real invitation: a pending one for this email, or a code
  // carried from an invitation link (which also pre-fills it). The code is what proves it.
  const canConnectToClinician = !isClinicianLinked && (hasPendingInvitation || !!initialInvitationCode || !!invitationRouteCode);
  const clinicianConnection = !showClinicianLink ? (
    <button onClick={() => setShowClinicianLink(true)} className="btn btn-secondary" style={{ width: '100%' }}>
      Connect to Clinician
    </button>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
      <label htmlFor="clinician-invitation-code" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
        Invitation code
      </label>
      <input
        id="clinician-invitation-code"
        value={invitationCode}
        onChange={(event) => setInvitationCode(event.target.value.toUpperCase())}
        placeholder="XXXX-XXXX-XXXX"
        autoComplete="off"
        autoFocus={!!initialInvitationCode}
        className="font-mono"
        style={{ width: '100%', padding: '11px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '16px', letterSpacing: '0.06em' }}
      />
      <div style={{ color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.4 }}>
        Use the code from your clinician. You must be signed in with the email address they invited.
      </div>
      {linkError && <div role="alert" style={{ color: 'var(--status-alert)', fontSize: '12px' }}>{linkError}</div>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={() => void handleLinkClinician()} disabled={isLinking || !invitationCode.trim()} className="btn btn-primary" style={{ flex: 1, padding: '11px 14px', fontSize: '13px', opacity: isLinking ? 0.7 : 1 }}>
          {isLinking ? 'Connecting…' : 'Accept Invitation'}
        </button>
        <button onClick={() => { setShowClinicianLink(false); setLinkError(null); }} disabled={isLinking} className="btn btn-ghost" style={{ padding: '11px 14px' }}>
          Cancel
        </button>
      </div>
    </div>
  );

  const exportCSV = async () => {
    let allSessions: SessionRecord[];
    try {
      allSessions = await storageEngine.getSessions(client.id);
    } catch {
      alert('Session data is unavailable right now. Try again after the connection recovers.');
      return;
    }
    if (allSessions.length === 0) {
      alert('No session data to export.');
      return;
    }
    exportPatientSessionCsv(allSessions, setExportStatus);
  };

  if (openGame && openGame.ownerId === client.id) {
    return <GameScreen gameId={openGame.gameId} initialView={openGame.initialView} eegProvider={demoModeEegProvider} onExit={() => setOpenGame(null)} />;
  }

  if (activeSessionExp && sessionOwnerId === client.id) {
    return (
      <SessionRunner
        client={client}
        onBaselinePersisted={(model) => onBaselinePersisted?.(client.id, model)}
        selectedExperience={activeSessionExp}
        onComplete={handleSessionComplete}
        onCancel={() => setActiveSessionExp(null)}
      />
    );
  }

  if (client.accountDeletionStartedAt) {
    return <div className="account-deletion-recovery" role="alert" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '24px', textAlign: 'center' }}>
      <h1>Finish deleting your account</h1>
      <p>Your clinic connection has been removed. Confirm your password to finish deleting your sign-in.</p>
      <button className="btn btn-secondary account-deletion-trigger account-deletion-finish" type="button" disabled={isDeletingAccount} onClick={openAccountDeletion}>Finish account deletion</button>
      {deletionPasswordForm}
      <button className="btn btn-secondary" type="button" onClick={handleLogout} disabled={signOutFlow.busy}>{signOutFlow.busy ? 'Signing out…' : 'Log Out'}</button>
      {signOutFlow.dialog}
    </div>;
  }

  if (completedSession && completedSession.patientId === client.id) {
    return (
      <PostSessionSummary
        session={completedSession}
        onViewProgress={() => {
          setCompletedSession(null);
          setActiveTab('progress');
        }}
      />
    );
  }

  if (showOnboarding) {
    return (
      <OnboardingFlow
        client={client}
        onFinish={async updated => {
          const nextProtocol = updated.assignedProtocol;
          if (!isClinicianLinked && nextProtocol) {
            // Re-running setup only to re-pair a headband must not discard a customized experience list.
            if (nextProtocol !== resolvedProtocol) await handleSaveTrainingSetup(buildSelfDirectedTrainingSetup(nextProtocol));
          } else {
            await onUpdateClient({ ...client, ...updated });
          }
          setShowOnboarding(false);
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        maxWidth: '480px',
        margin: '0 auto',
        backgroundColor: 'var(--surface-patient-base)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        boxShadow: '0 0 40px rgba(0,0,0,0.06)',
      }}
    >
      {/* Patient App Top Bar */}
      <header
        style={{
          padding: '16px 20px',
          paddingTop: 'max(16px, env(safe-area-inset-top, 16px))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--surface-patient-card)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isClinicianLinked && brand.logoUrl && brand.logoUrl.startsWith('data:image') ? (
            <img
              src={brand.logoUrl}
              alt="Clinic Logo"
              style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px' }}
            />
          ) : (
            <BrandLogo size={28} variant="terracotta" />
          )}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{isClinicianLinked ? brand.name : APP_DISPLAY_NAME}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Training Portal</div>
          </div>
        </div>

      </header>

      {/* Main Tab Content */}
      <main style={{ flex: 1, padding: '20px' }}>
        {activeTab === 'home' && isClinicianLinked && initialInvitationCode && !pendingInvitationAlreadyAccepted && (
          <section className="card-patient" aria-label="Clinician invitation" style={{ marginBottom: '16px' }}>
            <p role="alert">You're already connected to a clinician. Disconnect before accepting another invitation.</p>
            <p>Invitation code: <span className="font-mono">{initialInvitationCode}</span></p>
            <button type="button" className="btn btn-secondary" onClick={onInvitationDismissed}>Dismiss invitation</button>
          </section>
        )}
        {activeTab === 'home' && canConnectToClinician && (
          <section className="card-patient" aria-label="Clinician invitation" style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>Have an invitation from your clinician?</div>
              <div style={{ marginTop: '3px', fontSize: '12px', color: 'var(--text-secondary)' }}>Connect your account so your clinician can manage your training plan.</div>
            </div>
            {clinicianConnection}
          </section>
        )}
        {activeTab === 'home' && (
          <HomeScreen
            client={client}
            onStartSession={handleStartSession}
            onOpenProtocolDetails={() => setShowProtocolDetails(true)}
            onOpenTrainingSetup={isClinicianLinked ? undefined : () => setShowTrainingSetup(true)}
            gamesSection={(
              <HomeOverview
                playerId={client.id}
                onPlay={() => setOpenGame({ gameId: 'mental-math', ownerId: client.id })}
                onOpenAchievements={() => { setProgressFocus('achievements'); setActiveTab('progress'); }}
                onOpenGameProgress={() => setOpenGame({ gameId: 'mental-math', ownerId: client.id, initialView: 'progress' })}
              />
            )}
          />
        )}

        {activeTab === 'sessions' && (
          <TrainTab
            allowedExperiences={client.allowedExperiences}
            onOpenGame={(gameId) => setOpenGame({ gameId, ownerId: client.id })}
            onStartExperience={handleStartSession}
          />
        )}

        {activeTab === 'progress' && (
          <ProgressHistory
            client={client}
            gamesSection={(
              <ProgressOverview
                playerId={client.id}
                onPlay={() => setOpenGame({ gameId: 'mental-math', ownerId: client.id })}
                focusSection={progressFocus}
                onSectionFocused={() => setProgressFocus(null)}
                games={<MentalMathProgressCard onOpen={() => setOpenGame({ gameId: 'mental-math', ownerId: client.id, initialView: 'progress' })} />}
              />
            )}
          />
        )}

        {activeTab === 'messages' && (
          <PatientMessagingView patientId={client.id} unreadMessageId={messageUnread.byPatient[client.id]?.unread ? messageUnread.byPatient[client.id].latestIncomingMessageId : null} notificationError={messageUnread.error} />
        )}

        {activeTab === 'appointments' && <PatientAppointmentsView />}

        {activeTab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
            {/* Profile Info Card */}
            <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {/* Avatar with upload overlay */}
                <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      if (file.size > 2 * 1024 * 1024) {
                        alert('Image must be under 2MB');
                        return;
                      }
                      const reader = new FileReader();
                      reader.onloadend = async () => {
                        const base64 = reader.result as string;
                        const updated = { ...client, avatarUrl: base64 };
                        setIsSavingProfile(true);
                        setProfileSaveError(null);
                        try {
                          await onUpdateClient(updated);
                          setPendingAvatarUrl(null);
                        } catch (error) {
                          setPendingAvatarUrl(base64);
                          setProfileSaveError(error instanceof Error ? error.message : 'The profile photo could not be saved.');
                        } finally {
                          setIsSavingProfile(false);
                        }
                      };
                      reader.readAsDataURL(file);
                    }
                  };
                  input.click();
                }} role="button" aria-label="Upload profile photo" aria-disabled={isSavingProfile}>
                  {client.avatarUrl && (client.avatarUrl.startsWith('data:') || client.avatarUrl.startsWith('blob:')) ? (
                    <img
                      src={client.avatarUrl}
                      alt={client.name}
                      style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--brand-primary-subtle)',
                        color: 'var(--brand-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '20px',
                        fontWeight: 700,
                      }}
                    >
                      {client.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                  )}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--brand-primary)',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid var(--surface-patient-card)',
                    }}
                  >
                    <Camera size={11} />
                  </div>
                </div>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600 }}>{client.name}</h2>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{client.email}</div>
                </div>
              </div>

              {profileSaveError && (
                <div role="alert" style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--status-alert-bg)', color: 'var(--status-alert)', fontSize: '12px' }}>
                  {profileSaveError}
                  <button
                    type="button"
                    disabled={isSavingProfile || !pendingAvatarUrl}
                    onClick={async () => {
                      if (!pendingAvatarUrl) return;
                      setIsSavingProfile(true);
                      setProfileSaveError(null);
                      try {
                        await onUpdateClient({ ...client, avatarUrl: pendingAvatarUrl });
                        setPendingAvatarUrl(null);
                      } catch (error) {
                        setProfileSaveError(error instanceof Error ? error.message : 'The profile photo could not be saved.');
                      } finally {
                        setIsSavingProfile(false);
                      }
                    }}
                    className="btn btn-ghost"
                    style={{ marginLeft: '8px' }}
                  >Retry</button>
                </div>
              )}

              <FactGrid
                style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}
                facts={[
                  // Goal and weekly target are care-team fields: shown only while a clinician manages the plan (values are kept on unlink).
                  ...(isClinicianLinked ? [{ label: 'Goal', value: client.condition || 'Unavailable' }] : []),
                  { label: 'Protocol', value: protocolAlias ? `${protocolAlias} · ${protocolName}` : protocolName },
                  // A linked patient sees "Connected to your clinician" just below instead.
                  ...(isClinicianLinked ? [] : [{ label: 'Training setup', value: TRAINING_AUTHORITY_LABEL[trainingAuthority] }]),
                  ...(isClinicianLinked
                    ? [{ label: 'Weekly target', value: client.prescribedSessionsPerWeek != null ? `${client.prescribedSessionsPerWeek} sessions / week` : 'Unavailable' }] : []),
                  { label: 'Completed', value: `${client.completedSessionsCount} sessions total` },
                ]}
              />
              {isClinicianLinked && (
                <span className="status-tag status-tag-active" style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '13px' }}>
                  <CheckCircle2 size={15} aria-hidden="true" />
                  <span>Connected to your clinician</span>
                </span>
              )}
              {canConnectToClinician && clinicianConnection}
            </div>
            <section className="card-patient" aria-label="Neural Imprint" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 12px' }}>
                <h2 style={{ fontSize: '17px', fontWeight: 600, margin: 0, whiteSpace: 'nowrap' }}>Neural Imprint</h2>
                <span className={`status-tag ${IMPRINT_TAG[imprintState.status]}`} style={{ flexShrink: 0, padding: '3px 10px' }}>{imprintLabel}</span>
              </div>
              {imprintState.status === 'not-calibrated' && (
                <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                  Calibrate with your headset to set your personal training baseline.
                </p>
              )}
              {imprintFacts.length > 0 && <FactGrid facts={imprintFacts} />}
              <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start', padding: '9px 20px', fontSize: '14px' }} onClick={onRecalibrate}>
                {imprintState.status === 'not-calibrated' ? 'Calibrate' : 'Recalibrate'}
              </button>
            </section>

            <div>
              <h2 className="section-label">Training</h2>
              <div className="list-group">
                {!isClinicianLinked && (
                  <button type="button" className="list-row" onClick={() => setShowTrainingSetup(true)} aria-label="Change Training Setup">
                    <SlidersHorizontal size={18} className="list-row-icon" aria-hidden="true" />
                    <span className="list-row-label">
                      Change Training Setup
                      <span className="list-row-hint">Protocol and experiences</span>
                    </span>
                    <ChevronRight size={16} className="list-row-trail" aria-hidden="true" />
                  </button>
                )}
                <button type="button" className="list-row" onClick={() => setShowProtocolDetails(true)} aria-label="View Protocol Details">
                  <ClipboardList size={18} className="list-row-icon" aria-hidden="true" />
                  <span className="list-row-label">Protocol Details</span>
                  <ChevronRight size={16} className="list-row-trail" aria-hidden="true" />
                </button>
                <button type="button" className="list-row" onClick={() => setShowOnboarding(true)}>
                  <RotateCcw size={18} className="list-row-icon" aria-hidden="true" />
                  <span className="list-row-label">
                    Redo Setup
                    <span className="list-row-hint">Training goal and headband</span>
                  </span>
                  <ChevronRight size={16} className="list-row-trail" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div>
              <h2 className="section-label">Account</h2>
              <div className="list-group">
                <button type="button" className="list-row" onClick={handleToggleMute}>
                  {isMuted ? <VolumeX size={18} className="list-row-icon" aria-hidden="true" /> : <Volume2 size={18} className="list-row-icon" aria-hidden="true" />}
                  {isMuted ? 'Unmute App Audio' : 'Mute App Audio'}
                </button>
                <button type="button" className="list-row" onClick={exportCSV}>
                  <FileText size={18} className="list-row-icon" aria-hidden="true" />
                  {exportStatus === 'done' ? 'Exported ✓' : 'Export Data (CSV)'}
                </button>
                {isClinicianLinked && (
                  <button type="button" className="list-row" onClick={() => setShowDisconnect(true)}>
                    <Unlink size={18} className="list-row-icon" aria-hidden="true" />
                    Disconnect from Clinician
                  </button>
                )}
                <button type="button" className="list-row" onClick={handleLogout} disabled={signOutFlow.busy}>
                  <LogOut size={18} className="list-row-icon" aria-hidden="true" />
                  {signOutFlow.busy ? 'Signing out…' : 'Log Out'}
                </button>
              </div>
            </div>

            <ChangePasswordForm variant="patient" />

            {/* Destructive action last, after routine account settings. */}
            <div className="list-group">
              <button
                onClick={openAccountDeletion}
                disabled={isDeletingAccount}
                className="list-row list-row-danger account-deletion-trigger"
                type="button"
              >
                <Trash2 size={18} className="list-row-icon" aria-hidden="true" />
                Delete Account
              </button>
              {deletionPasswordForm && <div style={{ padding: '0 16px 16px' }}>{deletionPasswordForm}</div>}
            </div>
          </div>
        )}
      </main>

      {showProtocolDetails && (
        <ProtocolDetailsModal client={client} onClose={() => setShowProtocolDetails(false)} />
      )}

      {showDisconnect && isClinicianLinked && (
        <DisconnectClinicianDialog onConfirm={handleDisconnectClinician} onClose={() => setShowDisconnect(false)} />
      )}

      {showTrainingSetup && (
        <SelfDirectedSetupModal client={client} onSave={handleSaveTrainingSetup} onClose={() => setShowTrainingSetup(false)} />
      )}

      {/* Patient Mobile Bottom Tab Bar */}
      <nav
        className="patient-bottom-nav"
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 20,
          backgroundColor: 'var(--surface-patient-card)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          padding: '4px 4px',
          paddingBottom: 'max(4px, env(safe-area-inset-bottom, 4px))',
        }}
      >
        {[
          { id: 'home', label: 'Home', icon: Home },
          { id: 'sessions', label: 'Train', icon: Compass },
          { id: 'progress', label: 'Progress', icon: Activity },
          { id: 'messages', label: 'Messages', icon: MessageSquare },
          { id: 'appointments', label: 'Visits', icon: CalendarDays },
          { id: 'profile', label: 'Profile', icon: User },
        ].filter(tab => isPatientTabAvailable(tab.id, trainingAuthority)).map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              aria-label={tab.id === 'messages' && hasUnreadMessage ? 'Messages, unread message' : tab.label}
              aria-current={isActive ? 'page' : undefined}
              style={{
                // Each tab fills its share of the bar so the whole column is tappable, not just the label.
                flex: '1 1 0',
                minHeight: '48px',
                padding: '6px 0',
                background: 'none',
                border: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: isActive ? 'var(--brand-primary)' : 'var(--text-tertiary)',
                transition: 'color 0.15s ease',
              }}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Icon size={19} />
                {tab.id === 'messages' && hasUnreadMessage && <span aria-hidden="true" className="message-unread-dot" />}
              </span>
              <span className="patient-nav-label" style={{ fontWeight: isActive ? 700 : 500 }}>{tab.label}</span>
            </button>
          );
        })}
      </nav>
      {signOutFlow.dialog}
    </div>
  );
};
