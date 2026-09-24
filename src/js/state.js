// ==================== SHARED APP STATE ====================

export const state = {
  userId: 'usr_' + Math.random().toString(36).substring(2, 9),
  alias: 'Operator-' + Math.floor(10 + Math.random() * 90),
  passkey: '',
  typingTimeout: null,
  peerConnection: null,
  localStream: null,
  activeCallType: null, // 'audio' | 'video' | null
  callTimerInterval: null,
  selectedFile: null,
  isRecordingVoice: false,
  mediaRecorder: null,
  audioChunks: [],
  voiceStart: 0,
  pendingOfferSignal: null,
  // presence & read receipts
  peerOnline: false,
  peerReadTs: 0,
  lastMarkedRead: 0,
  // message history window
  messages: [],
  renderStart: 0,
  visibleCount: 50,
  replayDone: false,
  // reply compose
  replyTo: null
}

// ==================== TINY EVENT BUS (presence → ticks) ====================
const subs = {}

export function on(event, fn) {
  ;(subs[event] || (subs[event] = [])).push(fn)
  return () => { subs[event] = subs[event].filter(f => f !== fn) }
}

export function emit(event, payload) {
  ;(subs[event] || []).forEach(fn => {
    try { fn(payload) } catch (e) { /* ignore listener errors */ }
  })
}

// ==================== SESSION PERSISTENCE ====================
const SESSION_KEY = 'prichat:session'

export function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ passkey: state.passkey, alias: state.alias }))
  } catch (e) { /* ignore */ }
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY))
    return s && s.passkey && s.passkey.length === 6 ? s : null
  } catch (e) { return null }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch (e) { /* ignore */ }
}