import React, { useState, useEffect, useRef } from 'react';
import { MessageThread } from '../../types';
import { Search, Send, CheckCheck, ArrowLeft, MessageSquare, AlertCircle } from 'lucide-react';

interface MessagingViewProps {
  threads: MessageThread[];
  selectedClientId?: string;
  onSendMessage: (clientId: string, text: string) => void;
}

const CLINICAL_QUICK_TEMPLATES = [
  'Reviewed your latest session: excellent Theta/Beta suppression trajectory!',
  'I have calibrated your adaptive threshold for tomorrow’s training on your Muse S Athena.',
  'Reminder: Ensure the frontal (AF7/AF8) sensors have snug contact against your forehead.',
  'Great consistency maintaining your weekly neurofeedback protocol schedule.',
  'Please take 3 slow diaphragmatic breaths before initiating your next session.',
];

export const MessagingView: React.FC<MessagingViewProps> = ({
  threads,
  selectedClientId,
  onSendMessage,
}) => {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [activeClientId, setActiveClientId] = useState<string | null>(
    selectedClientId || (threads.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 768 ? threads[0].clientId : null)
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Synchronize when selectedClientId prop changes (e.g. from ClientDetailView "Message" button)
  useEffect(() => {
    if (selectedClientId) {
      setActiveClientId(selectedClientId);
    } else if (!activeClientId && threads.length > 0 && !isMobile) {
      setActiveClientId(threads[0].clientId);
    }
  }, [selectedClientId, threads, isMobile]);

  const activeThread = threads.find((t) => t.clientId === activeClientId);

  // Auto-scroll to latest message on active thread or messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeClientId) return;

    onSendMessage(activeClientId, inputText.trim());
    setInputText('');
  };

  const handleQuickTemplate = (templateText: string) => {
    if (!activeClientId) return;
    onSendMessage(activeClientId, templateText);
  };

  const filteredThreads = threads.filter((t) =>
    t.clientName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className="card-clinician"
      style={{
        padding: '0',
        height: 'calc(100vh - 160px)',
        minHeight: '520px',
        display: 'flex',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
        position: 'relative',
      }}
    >
      {/* Left Conversation List */}
      <div
        style={{
          width: activeClientId ? (isMobile ? '0' : '320px') : '100%',
          display: activeClientId && isMobile ? 'none' : 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-default)',
          backgroundColor: 'var(--surface-clinician-card)',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-default)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Patient Messages
            </h2>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              {threads.length} {threads.length === 1 ? 'Conversation' : 'Conversations'}
            </span>
          </div>
          <div
            style={{
              background: 'var(--surface-clinician-sidebar)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Search size={14} color="var(--text-tertiary)" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patient chats..."
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: '12px',
                outline: 'none',
                width: '100%',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredThreads.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              No message threads found.
            </div>
          ) : (
            filteredThreads.map((thread) => {
              const isSelected = thread.clientId === activeClientId;
              const lastMsg = thread.messages[thread.messages.length - 1];
              return (
                <div
                  key={thread.clientId}
                  onClick={() => setActiveClientId(thread.clientId)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--surface-patient-base)' : 'transparent',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    <img
                      src={thread.clientAvatar}
                      alt={thread.clientName}
                      style={{ width: '38px', height: '38px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                    {thread.unreadCount > 0 && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '-2px',
                          right: '-2px',
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--brand-primary)',
                          border: '2px solid #FFFFFF',
                        }}
                      />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {thread.clientName}
                        </span>
                        {thread.isDemo && (
                          <span
                            style={{
                              fontSize: '9px',
                              background: 'var(--surface-clinician-sidebar)',
                              color: 'var(--text-tertiary)',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              fontWeight: 600,
                            }}
                          >
                            Demo
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {thread.lastMessageTime}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: thread.unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: thread.unreadCount > 0 ? 600 : 400,
                        marginTop: '3px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lastMsg?.text || 'No messages yet'}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Active Thread View */}
      <div
        style={{
          flex: 1,
          display: activeClientId || window.innerWidth >= 768 ? 'flex' : 'none',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {activeThread ? (
          <>
            {/* Thread Header */}
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border-default)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                backgroundColor: '#FFFFFF',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={() => setActiveClientId(null)}
                  className="btn btn-ghost"
                  style={{
                    padding: '4px 6px',
                    marginRight: '2px',
                    display: window.innerWidth < 768 ? 'flex' : 'none',
                    alignItems: 'center',
                  }}
                  title="Back to conversations"
                >
                  <ArrowLeft size={18} />
                </button>
                <img
                  src={activeThread.clientAvatar}
                  alt={activeThread.clientName}
                  style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {activeThread.clientName}
                    </span>
                    {activeThread.isDemo ? (
                      <span
                        style={{
                          fontSize: '10px',
                          background: 'var(--surface-clinician-sidebar)',
                          color: 'var(--text-secondary)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}
                      >
                        Sample Patient
                      </span>
                    ) : (
                      <span style={{ fontSize: '11px', color: 'var(--status-active)' }}>
                        ● Active Protocol Patient
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    HIPAA Secure Channel • Muse S Athena Remote Monitoring
                  </div>
                </div>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div
              style={{
                flex: 1,
                padding: '16px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                backgroundColor: 'var(--surface-clinician-base)',
              }}
            >
              {activeThread.messages.map((msg) => {
                const isClinician = msg.sender === 'clinician';
                return (
                  <div
                    key={msg.id}
                    style={{
                      alignSelf: isClinician ? 'flex-end' : 'flex-start',
                      maxWidth: '82%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isClinician ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '13px',
                        lineHeight: 1.5,
                        backgroundColor: isClinician ? '#3A4B58' : '#FFFFFF',
                        color: isClinician ? '#FFFFFF' : 'var(--text-primary)',
                        border: isClinician ? 'none' : '1px solid var(--border-default)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      }}
                    >
                      {msg.text}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-tertiary)',
                        marginTop: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <span>{msg.timestamp}</span>
                      {isClinician && <CheckCheck size={12} color="var(--status-active)" />}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Clinical Quick Responses */}
            <div
              style={{
                padding: '8px 14px',
                backgroundColor: 'var(--surface-patient-base)',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                gap: '6px',
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-tertiary)', flexShrink: 0 }}>
                <MessageSquare size={12} color="var(--brand-primary)" />
                <span>Quick:</span>
              </div>
              {CLINICAL_QUICK_TEMPLATES.map((tmpl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleQuickTemplate(tmpl)}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-full)',
                    padding: '3px 10px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--brand-primary)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {tmpl.slice(0, 32)}...
                </button>
              ))}
            </div>

            {/* Compose Bar */}
            <form
              onSubmit={handleSend}
              style={{
                padding: '10px 14px',
                borderTop: '1px solid var(--border-default)',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                backgroundColor: '#FFFFFF',
              }}
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Message ${activeThread.clientName}...`}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  fontSize: '13px',
                  outline: 'none',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="submit"
                className="btn btn-dense"
                disabled={!inputText.trim()}
                style={{
                  padding: '9px 16px',
                  fontSize: '13px',
                  opacity: inputText.trim() ? 1 : 0.6,
                }}
              >
                <Send size={14} /> Send
              </button>
            </form>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
              fontSize: '13px',
              gap: '8px',
            }}
          >
            <AlertCircle size={32} color="var(--border-default)" />
            <span>Select a conversation from the roster to start messaging</span>
          </div>
        )}
      </div>
    </div>
  );
};
