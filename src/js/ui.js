// ==================== DOM REFS & UI HELPERS ====================

import { state } from './state.js'

export const el = {
  loginScreen: document.getElementById('screen-login'),
  chatScreen: document.getElementById('screen-chat'),
  pinInputs: Array.from(document.querySelectorAll('.pin-input')),
  aliasInput: document.getElementById('user-alias'),
  btnConnect: document.getElementById('btn-connect'),
  btnRandomKey: document.getElementById('btn-random-key'),
  btnLeave: document.getElementById('btn-leave'),
  activeRoomsList: document.getElementById('active-rooms-list'),
  channelCountBadge: document.getElementById('channel-count-badge'),
  roomPasskeyDisplay: document.getElementById('room-passkey-display'),
  peerStatusLabel: document.getElementById('peer-status-label'),
  messagesContainer: document.getElementById('messages-container'),
  chatInput: document.getElementById('chat-input'),
  btnSendMsg: document.getElementById('btn-send-msg'),
  btnAttachFile: document.getElementById('btn-attach-file'),
  fileInput: document.getElementById('file-input'),
  filePreviewBar: document.getElementById('file-preview-bar'),
  previewFilename: document.getElementById('preview-filename'),
  previewFilesize: document.getElementById('preview-filesize'),
  btnCancelFile: document.getElementById('btn-cancel-file'),
  btnRecordVoice: document.getElementById('btn-record-voice'),
  typingIndicator: document.getElementById('typing-indicator'),
  btnStartAudioCall: document.getElementById('btn-start-audio-call'),
  btnStartVideoCall: document.getElementById('btn-start-video-call'),
  incomingCallModal: document.getElementById('incoming-call-modal'),
  incomingCallerId: document.getElementById('incoming-caller-id'),
  incomingCallType: document.getElementById('incoming-call-type'),
  btnAcceptCall: document.getElementById('btn-accept-call'),
  btnDeclineCall: document.getElementById('btn-decline-call'),
  videoCallStage: document.getElementById('video-call-stage'),
  localVideo: document.getElementById('localVideo'),
  remoteVideo: document.getElementById('remoteVideo'),
  btnEndCall: document.getElementById('btn-end-call'),
  btnToggleMic: document.getElementById('btn-toggle-mic'),
  btnToggleCam: document.getElementById('btn-toggle-cam'),
  btnPanicMode: document.getElementById('btn-panic-mode'),
  decoyScreen: document.getElementById('decoy-screen'),
  toast: document.getElementById('toast'),
  toastMsg: document.getElementById('toast-msg'),
  toastIcon: document.getElementById('toast-icon'),
  // invite link
  btnCopyInvite: document.getElementById('btn-copy-invite'),
  btnSoundNotification: document.getElementById('btn-sound-notification'),
  // reply compose
  replyBar: document.getElementById('reply-bar'),
  replyBarAlias: document.getElementById('reply-bar-alias'),
  replyBarText: document.getElementById('reply-bar-text'),
  btnCancelReply: document.getElementById('btn-cancel-reply'),
  // image lightbox
  lightbox: document.getElementById('image-lightbox'),
  lightboxImg: document.getElementById('lightbox-img'),
  lightboxClose: document.getElementById('lightbox-close')
}

// Preset operator alias
el.aliasInput.value = state.alias

// ==================== LIGHTBOX ====================
el.lightboxClose.addEventListener('click', closeLightbox)
el.lightbox.addEventListener('click', (e) => {
  if (e.target === el.lightbox) closeLightbox()
})

export function openLightbox(src) {
  el.lightboxImg.src = src
  el.lightbox.classList.remove('hidden')
  el.lightbox.classList.add('flex')
}

export function closeLightbox() {
  el.lightbox.classList.add('hidden')
  el.lightbox.classList.remove('flex')
  el.lightboxImg.src = ''
}

export function isLightboxOpen() {
  return !el.lightbox.classList.contains('hidden')
}

// ==================== PASSKEY INPUTS ====================
export function setupPinInputs() {
  el.pinInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '')
      e.target.value = val

      if (val && index < el.pinInputs.length - 1) {
        el.pinInputs[index + 1].focus()
      }
      checkPasskeyComplete()
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && index > 0) {
        el.pinInputs[index - 1].focus()
      }
    })

    // Handle Paste event for whole key (e.g. 123456 or 123-456)
    input.addEventListener('paste', (e) => {
      e.preventDefault()
      const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '')
      if (pasted.length >= 6) {
        for (let i = 0; i < 6; i++) {
          el.pinInputs[i].value = pasted[i]
        }
        el.pinInputs[5].focus()
        checkPasskeyComplete()
      }
    })
  })
}

export function fillPasskey(key) {
  const digits = String(key || '').replace(/[^0-9]/g, '').slice(0, 6)
  if (digits.length !== 6) return
  for (let i = 0; i < 6; i++) {
    el.pinInputs[i].value = digits[i]
  }
  checkPasskeyComplete()
}

export function getEnteredPasskey() {
  return el.pinInputs.map(i => i.value).join('')
}

export function checkPasskeyComplete() {
  const key = getEnteredPasskey()
  if (key.length === 6) {
    el.btnConnect.disabled = false
    el.btnConnect.classList.add('animate-bounce')
    setTimeout(() => el.btnConnect.classList.remove('animate-bounce'), 1000)
  } else {
    el.btnConnect.disabled = true
  }
}

export function formatPasskey(key) {
  if (!key || key.length !== 6) return key
  return key.substring(0, 3) + '-' + key.substring(3, 6)
}

// ==================== TOASTS & SOUND ====================
export function showToast(msg, icon = '⚡') {
  el.toastMsg.innerText = msg
  el.toastIcon.innerText = icon
  el.toast.classList.remove('opacity-0', 'pointer-events-none')
  setTimeout(() => {
    el.toast.classList.add('opacity-0', 'pointer-events-none')
  }, 3000)
}

// Tiny synth "blip" — no audio assets needed
export function playBlip(freq = 880, dur = 0.06) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.05, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + dur)
    osc.onended = () => { try { ctx.close() } catch (e) { /* ignore */ } }
  } catch (e) { /* ignore */ }
}

// ==================== COPY ====================
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch (e2) { /* ignore */ }
    ta.remove()
    return true
  }
}

// ==================== ESCAPING ====================
export function escapeHtml(str) {
  return str
    ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    : ''
}