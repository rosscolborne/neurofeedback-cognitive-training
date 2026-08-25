import React, { useState } from 'react';
import {
  CalendarAppointment,
  ClientProfile,
  AppointmentType,
  AppointmentStatus,
  ProtocolType,
  ExperienceType,
} from '../../types';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Video,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Headphones,
  User,
  Filter,
  Trash2,
  MessageSquare,
} from 'lucide-react';

interface ClinicalCalendarViewProps {
  clients: ClientProfile[];
  appointments: CalendarAppointment[];
  onSaveAppointment: (appt: CalendarAppointment) => void;
  onDeleteAppointment: (id: string) => void;
  onSelectClient?: (client: ClientProfile) => void;
  onOpenMessages?: (clientId: string) => void;
}

export const ClinicalCalendarView: React.FC<ClinicalCalendarViewProps> = ({
  clients,
  appointments,
  onSaveAppointment,
  onDeleteAppointment,
  onSelectClient,
  onOpenMessages,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'agenda'>('month');
  const [typeFilter, setTypeFilter] = useState<'all' | AppointmentType>('all');
  const [selectedPatientId, setSelectedPatientId] = useState<string>('all');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingAppt, setEditingAppt] = useState<CalendarAppointment | null>(null);

  // Modal Form State
  const [formClientId, setFormClientId] = useState(clients[0]?.id || '');
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formTime, setFormTime] = useState('10:00');
  const [formDuration, setFormDuration] = useState(45);
  const [formType, setFormType] = useState<AppointmentType>('remote-training');
  const [formProtocol, setFormProtocol] = useState<ProtocolType>('theta-beta-ratio');
  const [formExperience, setFormExperience] = useState<ExperienceType>('skyline-drift');
  const [formHardware, setFormHardware] = useState<'Muse S (Athena)' | 'Muse 2' | '19-Ch QEEG Clinical'>('Muse S (Athena)');
  const [formNotes, setFormNotes] = useState('');

  // Month navigation
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Generate days in month grid
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const filteredAppointments = appointments.filter((appt) => {
    const matchesType = typeFilter === 'all' || appt.type === typeFilter;
    const matchesPatient = selectedPatientId === 'all' || appt.clientId === selectedPatientId;
    return matchesType && matchesPatient;
  });

  const handleOpenNewModal = (prefilledDate?: string) => {
    setEditingAppt(null);
    setFormClientId(clients[0]?.id || '');
    setFormDate(prefilledDate || new Date().toISOString().split('T')[0]);
    setFormTime('10:00');
    setFormDuration(45);
    setFormType('remote-training');
    setFormProtocol('theta-beta-ratio');
    setFormExperience('skyline-drift');
    setFormHardware('Muse S (Athena)');
    setFormNotes('');
    setShowScheduleModal(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    const patient = clients.find((c) => c.id === formClientId);
    if (!patient) return;

    const newAppt: CalendarAppointment = {
      id: editingAppt ? editingAppt.id : 'appt-' + Date.now(),
      clientId: patient.id,
      clientName: patient.name,
      clientAvatar: patient.avatarUrl,
      clientCondition: patient.condition,
      date: formDate,
      time: formTime,
      durationMinutes: Number(formDuration),
      type: formType,
      protocol: formProtocol,
      experience: formExperience,
      status: editingAppt ? editingAppt.status : 'scheduled',
      notes: formNotes,
      isDemo: patient.isDemo || false,
      hardwareProfile: formHardware,
    };

    onSaveAppointment(newAppt);
    setShowScheduleModal(false);
  };

  const handleUpdateStatus = (appt: CalendarAppointment, newStatus: AppointmentStatus) => {
    onSaveAppointment({ ...appt, status: newStatus });
  };

  const getTypeLabel = (type: AppointmentType) => {
    switch (type) {
      case 'remote-training':
        return 'Remote Training (Athena)';
      case 'in-clinic-evaluation':
        return 'In-Clinic Evaluation';
      case 'qeeg-mapping':
        return '19-Ch QEEG Mapping';
      case 'protocol-review':
        return 'Protocol Review';
      case 'consultation':
        return 'Consultation';
    }
  };

  const getTypeBadgeColor = (type: AppointmentType) => {
    switch (type) {
      case 'remote-training':
        return { bg: '#FDF0EB', text: 'var(--brand-primary)', border: '#E8967A44' };
      case 'in-clinic-evaluation':
        return { bg: '#F0F4ED', text: 'var(--status-active)', border: '#5C8C4644' };
      case 'qeeg-mapping':
        return { bg: '#F2EFF8', text: 'var(--status-completed)', border: '#6554A044' };
      default:
        return { bg: 'var(--surface-clinician-sidebar)', text: 'var(--text-secondary)', border: 'var(--border-default)' };
    }
  };

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case 'scheduled':
        return <span className="status-tag" style={{ background: '#EBF4FE', color: '#2B6CB0' }}>Scheduled</span>;
      case 'in-progress':
        return <span className="status-tag status-tag-active">In Progress</span>;
      case 'completed':
        return <span className="status-tag status-tag-completed">✓ Completed</span>;
      case 'cancelled':
        return <span className="status-tag" style={{ background: 'var(--surface-clinician-sidebar)', color: 'var(--text-tertiary)' }}>Cancelled</span>;
      case 'missed':
        return <span className="status-tag status-tag-alert">Missed</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header & Scheduling Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="font-body" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Clinical Session Calendar
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Schedule and manage remote Muse S Athena protocols & in-clinic neurofeedback visitations.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleOpenNewModal()}
            className="btn btn-dense"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
          >
            <Plus size={16} /> Schedule Session
          </button>
        </div>
      </div>

      {/* Filter and View Controls Bar */}
      <div
        className="card-clinician"
        style={{
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Month Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button onClick={handlePrevMonth} className="btn btn-ghost" style={{ padding: '6px 8px' }}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: '15px', fontWeight: 600, minWidth: '140px', textAlign: 'center' }}>
              {monthName}
            </span>
            <button onClick={handleNextMonth} className="btn btn-ghost" style={{ padding: '6px 8px' }}>
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            onClick={handleToday}
            className="btn btn-ghost"
            style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid var(--border-default)' }}
          >
            Today
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Patient Selector */}
          <select
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)',
              fontSize: '12px',
              background: '#FFFFFF',
              color: 'var(--text-primary)',
            }}
          >
            <option value="all">All Patients ({clients.length})</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.isDemo ? '(Sample)' : ''}
              </option>
            ))}
          </select>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            style={{
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)',
              fontSize: '12px',
              background: '#FFFFFF',
              color: 'var(--text-primary)',
            }}
          >
            <option value="all">All Modalities</option>
            <option value="remote-training">Remote Training (Athena)</option>
            <option value="in-clinic-evaluation">In-Clinic Evaluation</option>
            <option value="qeeg-mapping">19-Ch QEEG Mapping</option>
            <option value="protocol-review">Protocol Review</option>
          </select>

          {/* View Toggle */}
          <div style={{ display: 'flex', background: 'var(--surface-clinician-sidebar)', borderRadius: 'var(--radius-sm)', padding: '2px' }}>
            <button
              onClick={() => setViewMode('month')}
              style={{
                border: 'none',
                background: viewMode === 'month' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'month' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: viewMode === 'month' ? 600 : 500,
                fontSize: '12px',
                padding: '4px 10px',
                borderRadius: '4px',
                cursor: 'pointer',
                boxShadow: viewMode === 'month' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              style={{
                border: 'none',
                background: viewMode === 'agenda' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'agenda' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: viewMode === 'agenda' ? 600 : 500,
                fontSize: '12px',
                padding: '4px 10px',
                borderRadius: '4px',
                cursor: 'pointer',
                boxShadow: viewMode === 'agenda' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              Agenda ({filteredAppointments.length})
            </button>
          </div>
        </div>
      </div>

      {/* MONTH VIEW GRID */}
      {viewMode === 'month' && (
        <div
          className="card-clinician"
          style={{
            padding: '0',
            overflow: 'hidden',
            backgroundColor: '#FFFFFF',
          }}
        >
          {/* Days Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              background: 'var(--surface-clinician-sidebar)',
              borderBottom: '1px solid var(--border-default)',
              textAlign: 'center',
              fontWeight: 600,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              padding: '10px 0',
            }}
          >
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          {/* Days Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gridAutoRows: 'minmax(110px, auto)',
            }}
          >
            {/* Empty slots for start of month */}
            {Array.from({ length: firstDayOfMonth }).map((_, idx) => (
              <div
                key={`empty-${idx}`}
                style={{
                  borderRight: '1px solid var(--border-subtle)',
                  borderBottom: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--surface-patient-base)',
                  opacity: 0.5,
                }}
              />
            ))}

            {/* Days of current month */}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const dayNum = idx + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const isToday =
                new Date().getFullYear() === year &&
                new Date().getMonth() === month &&
                new Date().getDate() === dayNum;

              const dayAppts = filteredAppointments.filter((a) => a.date === dateStr);

              return (
                <div
                  key={`day-${dayNum}`}
                  style={{
                    borderRight: '1px solid var(--border-subtle)',
                    borderBottom: '1px solid var(--border-subtle)',
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    backgroundColor: isToday ? '#FDF8F5' : '#FFFFFF',
                    minHeight: '105px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: isToday ? 700 : 500,
                        color: isToday ? 'var(--brand-primary)' : 'var(--text-primary)',
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: isToday ? 'var(--brand-primary-subtle)' : 'transparent',
                      }}
                    >
                      {dayNum}
                    </span>
                    <button
                      onClick={() => handleOpenNewModal(dateStr)}
                      className="btn btn-ghost"
                      style={{ padding: '2px 4px', fontSize: '10px', color: 'var(--text-tertiary)' }}
                      title="Schedule on this day"
                    >
                      +
                    </button>
                  </div>

                  {/* Day Appointment Pills */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '2px' }}>
                    {dayAppts.map((appt) => {
                      const colors = getTypeBadgeColor(appt.type);
                      return (
                        <div
                          key={appt.id}
                          onClick={() => {
                            setEditingAppt(appt);
                            setFormClientId(appt.clientId);
                            setFormDate(appt.date);
                            setFormTime(appt.time);
                            setFormDuration(appt.durationMinutes);
                            setFormType(appt.type);
                            setFormProtocol(appt.protocol);
                            setFormExperience(appt.experience || 'skyline-drift');
                            setFormHardware(appt.hardwareProfile || 'Muse S (Athena)');
                            setFormNotes(appt.notes || '');
                            setShowScheduleModal(true);
                          }}
                          style={{
                            background: colors.bg,
                            color: colors.text,
                            border: `1px solid ${colors.border}`,
                            borderRadius: '4px',
                            padding: '3px 6px',
                            fontSize: '10px',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title={`${appt.time} - ${appt.clientName}: ${getTypeLabel(appt.type)}`}
                        >
                          <Clock size={10} />
                          <span style={{ fontWeight: 600 }}>{appt.time}</span>
                          <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {appt.clientName.split(' ')[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AGENDA LIST VIEW */}
      {viewMode === 'agenda' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredAppointments.length === 0 ? (
            <div className="card-clinician" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <CalendarIcon size={32} style={{ margin: '0 auto 8px auto', opacity: 0.4 }} />
              <div>No appointments found for the selected filter.</div>
              <button
                onClick={() => handleOpenNewModal()}
                className="btn btn-dense"
                style={{ marginTop: '12px', fontSize: '12px' }}
              >
                Schedule First Session
              </button>
            </div>
          ) : (
            filteredAppointments.map((appt) => {
              const colors = getTypeBadgeColor(appt.type);
              return (
                <div
                  key={appt.id}
                  className="card-clinician"
                  style={{
                    padding: '16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '14px',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: '240px' }}>
                    <img
                      src={appt.clientAvatar}
                      alt={appt.clientName}
                      style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {appt.clientName}
                        </span>
                        {appt.isDemo && (
                          <span
                            style={{
                              fontSize: '10px',
                              background: 'var(--surface-clinician-sidebar)',
                              color: 'var(--text-tertiary)',
                              padding: '1px 5px',
                              borderRadius: '4px',
                            }}
                          >
                            Sample
                          </span>
                        )}
                        {getStatusBadge(appt.status)}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span>📅 {appt.date}</span>
                        <span>⏰ {appt.time} ({appt.durationMinutes} min)</span>
                        <span>• Protocol: <strong>{appt.protocol.replace(/-/g, ' ')}</strong></span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            background: colors.bg,
                            color: colors.text,
                            border: `1px solid ${colors.border}`,
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '11px',
                            fontWeight: 500,
                          }}
                        >
                          {getTypeLabel(appt.type)}
                        </span>
                        <span
                          style={{
                            background: 'var(--surface-clinician-sidebar)',
                            color: 'var(--text-secondary)',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '11px',
                          }}
                        >
                          Hardware: {appt.hardwareProfile || 'Muse S (Athena)'}
                        </span>
                      </div>
                      {appt.notes && (
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px', fontStyle: 'italic' }}>
                          Note: {appt.notes}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {appt.status === 'scheduled' && (
                      <>
                        <button
                          onClick={() => handleUpdateStatus(appt, 'completed')}
                          className="btn btn-ghost"
                          style={{ fontSize: '12px', padding: '6px 10px', color: 'var(--status-active)' }}
                          title="Mark Completed"
                        >
                          <CheckCircle2 size={15} /> Mark Complete
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(appt, 'cancelled')}
                          className="btn btn-ghost"
                          style={{ fontSize: '12px', padding: '6px 10px', color: 'var(--text-tertiary)' }}
                          title="Cancel"
                        >
                          <XCircle size={15} /> Cancel
                        </button>
                      </>
                    )}

                    {onOpenMessages && (
                      <button
                        onClick={() => onOpenMessages(appt.clientId)}
                        className="btn btn-ghost"
                        style={{ fontSize: '12px', padding: '6px 10px' }}
                        title="Send Message"
                      >
                        <MessageSquare size={14} /> Message
                      </button>
                    )}

                    <button
                      onClick={() => onDeleteAppointment(appt.id)}
                      className="btn btn-ghost"
                      style={{ fontSize: '12px', padding: '6px 8px', color: 'var(--status-alert)' }}
                      title="Delete Event"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* SCHEDULE APPOINTMENT MODAL */}
      {showScheduleModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            backgroundColor: 'rgba(26, 26, 26, 0.55)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            className="card-clinician"
            style={{
              width: '100%',
              maxWidth: '540px',
              maxHeight: '90vh',
              overflowY: 'auto',
              backgroundColor: '#FFFFFF',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                {editingAppt ? 'Edit Clinical Appointment' : 'Schedule Clinical Session'}
              </h2>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="btn btn-ghost"
                style={{ padding: '6px' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Patient
                </label>
                <select
                  value={formClientId}
                  onChange={(e) => setFormClientId(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    fontSize: '13px',
                    background: '#FFFFFF',
                  }}
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} • {c.condition} {c.isDemo ? '(Sample)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Session Date
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      fontSize: '13px',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Start Time
                  </label>
                  <input
                    type="time"
                    required
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Session Modality / Type
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      fontSize: '13px',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value="remote-training">Remote Training (Athena)</option>
                    <option value="in-clinic-evaluation">In-Clinic Evaluation</option>
                    <option value="qeeg-mapping">19-Ch QEEG Mapping</option>
                    <option value="protocol-review">Protocol Review</option>
                    <option value="consultation">Clinical Consultation</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    EEG Hardware Profile
                  </label>
                  <select
                    value={formHardware}
                    onChange={(e) => setFormHardware(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      fontSize: '13px',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value="Muse S (Athena)">Muse S (Athena) 4-Ch</option>
                    <option value="Muse 2">Muse 2 Headband</option>
                    <option value="19-Ch QEEG Clinical">19-Ch QEEG Clinical Cap</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Assigned Neuro Protocol
                  </label>
                  <select
                    value={formProtocol}
                    onChange={(e) => setFormProtocol(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      fontSize: '13px',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value="theta-beta-ratio">Lubar Theta/Beta Ratio (TBR)</option>
                    <option value="smr-enhancement">Sterman SMR (12-15 Hz)</option>
                    <option value="alpha-enhancement">Hardt Posterior Alpha</option>
                    <option value="alpha-theta-crossover">Peniston Alpha-Theta</option>
                    <option value="beta-downtraining">Beta De-arousal Suppression</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Duration (Minutes)
                  </label>
                  <select
                    value={formDuration}
                    onChange={(e) => setFormDuration(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      fontSize: '13px',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value={20}>20 Minutes</option>
                    <option value={25}>25 Minutes</option>
                    <option value={30}>30 Minutes</option>
                    <option value={45}>45 Minutes</option>
                    <option value={60}>60 Minutes</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Clinical Instructions & Notes
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="e.g. Focus on frontal theta suppression at AF7/AF8 with baseline impedance check."
                  style={{
                    width: '100%',
                    height: '60px',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    fontSize: '12px',
                    resize: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="btn btn-ghost"
                  style={{ padding: '8px 14px', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-dense"
                  style={{ padding: '8px 18px', fontSize: '13px' }}
                >
                  {editingAppt ? 'Save Changes' : 'Confirm Appointment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
