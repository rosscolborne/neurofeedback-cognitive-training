import React, { useState } from 'react';
import { MessageThread } from '../../types';
import { Search, Send, Paperclip, CheckCheck, ArrowLeft } from 'lucide-react';

interface MessagingViewProps {
  threads: MessageThread[];
  selectedClientId?: string;
  onSendMessage: (clientId: string, text: string) => void;
}

export const MessagingView: React.FC<MessagingViewProps> = ({
  threads,
  selectedClientId,
  onSendMessage,
}) => {
  const [activeClientId, setActiveClientId] = useState<string | null>(selectedClientId || (window.innerWidth >= 768 ? threads[0]?.clientId || null : null));
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');

  const activeThread = threads.find(t => t.clientId === activeClientId);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeThread) return;

    onSendMessage(activeThread.clientId, inputText);
    setInputText('');
  };

  const filteredThreads = threads.filter(t =>
    t.clientName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className="card-clinician"
      style={{
        padding: '0',
        height: 'calc(100vh - 170px)',
        minHeight: '480px',
        display: 'flex',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
        position: 'relative',
      }}
    >
      {/* Left Conversation List (Full width on mobile when no thread active, 320px on desktop) */}
      <div
        style={{
          width: activeClientId ? (window.innerWidth < 768 ? '0' : '320px') : '100%',
          display: activeClientId && window.innerWidth < 768 ? 'none' : 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-default)',
          backgroundColor: 'var(--surface-clinician-card)',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-default)' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>Conversations</h2>
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
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search patient chats..."
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: '12px',
                outline: 'none',
                width: '100%',
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredThreads.map(thread => {
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
                      }}
                    />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {thread.clientName}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      {thread.lastMessageTime.split(' ')[0]}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
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
          })}
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
                  style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover' }}
                />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{activeThread.clientName}</div>
                  <div style={{ fontSize: '11px', color: 'var(--status-active)' }}>● Patient Active</div>
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
              {activeThread.messages.map(msg => {
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
                        lineHeight: 1.45,
                        backgroundColor: isClinician ? '#E4E7EB' : 'var(--surface-patient-base)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {msg.text}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>{msg.timestamp}</span>
                      {isClinician && <CheckCheck size={12} color="var(--status-active)" />}
                    </div>
                  </div>
                );
              })}
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
              <button type="button" className="btn btn-ghost" style={{ padding: '6px 8px' }}>
                <Paperclip size={16} color="var(--text-tertiary)" />
              </button>
              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder={`Message ${activeThread.clientName}...`}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <button type="submit" className="btn btn-dense" style={{ padding: '8px 14px', fontSize: '12px' }}>
                <Send size={14} />
              </button>
            </form>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
            Select a conversation to view messages
          </div>
        )}
      </div>
    </div>
  );
};
