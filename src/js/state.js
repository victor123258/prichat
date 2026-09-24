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
  pendingOfferSignal: null
};