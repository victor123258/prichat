// ==================== PRI CHAT — APPLICATION ENTRY POINT ====================

import { el, setupPinInputs, getEnteredPasskey, checkPasskeyComplete, formatPasskey, showToast } from './ui.js'
import { state } from './state.js'
import { monitorActiveRooms, joinChannel, leaveChannel } from './db.js'
import { startChatListeners, stopChatListeners } from './chat.js'
import { startCallListeners, stopCallListeners } from './calls.js'

setupPinInputs()
monitorActiveRooms()

// Random Key Generator Trigger
el.btnRandomKey.addEventListener('click', () => {
  const randomKey = Math.floor(100000 + Math.random() * 900000).toString()
  for (let i = 0; i < 6; i++) {
    el.pinInputs[i].value = randomKey[i]
  }
  checkPasskeyComplete()
  showToast('Key Generated: ' + formatPasskey(randomKey), '🔑')
})

// Connect / Launch Channel
el.btnConnect.addEventListener('click', () => {
  const key = getEnteredPasskey()
  if (key.length !== 6) return

  state.alias = el.aliasInput.value.trim() || state.alias
  joinChannel(key)

  // Switch Screens
  el.loginScreen.classList.add('hidden')
  el.chatScreen.classList.remove('hidden')
  el.roomPasskeyDisplay.innerText = 'KEY: ' + formatPasskey(key)

  // Initialize Chat + Call Stream Listeners
  startChatListeners()
  startCallListeners()

  showToast('Direct Link Established', '🔒')
})

// Disconnect & Leave
el.btnLeave.addEventListener('click', () => {
  stopChatListeners()
  stopCallListeners()
  leaveChannel()

  el.chatScreen.classList.add('hidden')
  el.loginScreen.classList.remove('hidden')
  showToast('Channel Disconnected')
})

// Panic Decoy Screen
el.btnPanicMode.addEventListener('click', toggleDecoyScreen)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    toggleDecoyScreen()
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