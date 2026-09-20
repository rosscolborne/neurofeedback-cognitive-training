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
    expect(clinicianShellSource).toContain('preSelectedClientId={selectedClient?.id}');
    expect(clinicianShellSource).not.toContain('threads={messages}');
    expect(clinicianShellSource).not.toContain('appointments={appointments}');
  });

  it('exposes linked-patient messaging and appointments with honest unlinked guidance', () => {
    expect(patientShellSource).toContain('<PatientMessagingView patientId={client.id} />');
    expect(patientShellSource).toContain('<PatientAppointmentsView />');
    expect(patientShellSource).toContain('<UnlinkedCareFeature feature="messages" />');
    expect(patientShellSource).toContain('<UnlinkedCareFeature feature="appointments" />');
    expect(patientShellSource).toContain('Connect your account with a clinician before using');
  });
});
