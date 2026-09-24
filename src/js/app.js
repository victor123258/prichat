// ==================== PRI CHAT — APPLICATION ENTRY POINT ====================

import {
  el, setupPinInputs, getEnteredPasskey, checkPasskeyComplete, formatPasskey,
  showToast, fillPasskey, copyText, isLightboxOpen, closeLightbox
} from './ui.js'
import { state, saveSession, loadSession, clearSession } from './state.js'
import { monitorActiveRooms, joinChannel, leaveChannel } from './db.js'
import { startChatListeners, stopChatListeners } from './chat.js'
import { startCallListeners, stopCallListeners } from './calls.js'

setupPinInputs()
monitorActiveRooms()

function getInviteLink(key) {
  const origin = location.origin
  const path = location.pathname
  return origin + path + '?key=' + key
}

/* ---------------------- connect / reconnect flow ---------------------- */

function connect(key) {
  if (!key || key.length !== 6) return

  state.alias = el.aliasInput.value.trim() || state.alias
  joinChannel(key)

  el.loginScreen.classList.add('hidden')
  el.chatScreen.classList.remove('hidden')
  el.roomPasskeyDisplay.innerText = 'KEY: ' + formatPasskey(key)

  startChatListeners()
  startCallListeners()

  saveSession()
  showToast('Direct Link Established', '🔒')

  // Ask for browser notification permission on first connect
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }
}

// Random Key Generator Trigger
el.btnRandomKey.addEventListener('click', () => {
  const randomKey = Math.floor(100000 + Math.random() * 900000).toString()
  fillPasskey(randomKey)
  showToast('Key Generated: ' + formatPasskey(randomKey), '🔑')
})

// Connect / Launch Channel
el.btnConnect.addEventListener('click', () => {
  connect(getEnteredPasskey())
})

// Copy invite link
el.btnCopyInvite.addEventListener('click', async () => {
  if (!state.passkey) return
  const ok = await copyText(getInviteLink(state.passkey))
  showToast(ok ? 'Invite link copied' : 'Copy failed', ok ? '🔗' : '⚠️')
})

// Disconnect & Leave
el.btnLeave.addEventListener('click', () => {
  stopChatListeners()
  stopCallListeners()
  leaveChannel()
  clearSession()

  el.chatScreen.classList.add('hidden')
  el.loginScreen.classList.remove('hidden')
  showToast('Channel Disconnected')
})

/* ---------------------- invite param autofill + session restore ---------------------- */

const urlKey = new URLSearchParams(location.search).get('key')

if (urlKey) {
  // Invite link — autofill the 6-digit key and let operator press connect.
  fillPasskey(urlKey)
  const session = loadSession()
  if (session) el.aliasInput.value = session.alias
} else {
  // Session restore — silently rejoin last active channel on refresh.
  const session = loadSession()
  if (session) {
    el.aliasInput.value = session.alias
    fillPasskey(session.passkey)
    connect(session.passkey)
  }
}

/* ---------------------- panic decoy + lightbox (ESC priority) ---------------------- */

el.btnPanicMode.addEventListener('click', toggleDecoyScreen)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (isLightboxOpen()) {
      closeLightbox()
    } else {
      toggleDecoyScreen()
    }
  }
})

function toggleDecoyScreen() {
  el.decoyScreen.classList.toggle('hidden')
}

// Register Service Worker (PWA) — production builds only
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch((err) => {
      console.warn('[PriChat] SW registration failed', err)
    })
  })
}