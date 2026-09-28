import { describe, expect, it } from 'vitest';
import appSource from '../../App.tsx?raw';
import clinicianShellSource from '../../components/clinician/ClinicianShell.tsx?raw';
import patientShellSource from '../../components/patient/PatientShell.tsx?raw';

describe('canonical messaging and appointment surface wiring', () => {
  it('does not load or mutate legacy whole-array messaging and appointments in App', () => {
    expect(appSource).not.toContain('subscribeToMessages');
    expect(appSource).not.toContain('saveMessageThread');
    expect(appSource).not.toContain('getAppointments');
    expect(appSource).not.toContain('saveAppointment');
    expect(appSource).not.toContain('deleteAppointment');
  });

  it('gives the clinician canonical repository-backed surfaces', () => {
    expect(clinicianShellSource).toContain('participants={clients.map');
    expect(clinicianShellSource).toContain('patientId: client.id');
    expect(clinicianShellSource).toContain('const linkedSelectedClient = clients.find((client) => client.id === selectedClient?.id) ?? null');
    expect(clinicianShellSource).toContain('preSelectedClientId={linkedSelectedClient?.id}');
    expect(clinicianShellSource).not.toContain('threads={messages}');
    expect(clinicianShellSource).not.toContain('appointments={appointments}');
  });

  it('exposes linked-patient messaging and appointments only while a clinician relationship is active', () => {
    expect(patientShellSource).toContain('<PatientMessagingView patientId={client.id} unreadMessageId={messageUnread.byPatient[client.id]?.unread');
    expect(patientShellSource).toContain('notificationError={messageUnread.error}');
    expect(patientShellSource).toContain('<PatientAppointmentsView />');
    // WB-102: unlinked patients get no dead-end Messages/Visits destinations.
    expect(patientShellSource).toContain('isPatientTabAvailable(requestedTab, trainingAuthority)');
    expect(patientShellSource).toContain('.filter(tab => isPatientTabAvailable(tab.id, trainingAuthority))');
    expect(patientShellSource).not.toContain('UnlinkedCareFeature');
  });
});
