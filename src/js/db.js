// ==================== FIREBASE REALTIME DATABASE ENGINE ====================
// The "backend": Firebase RTDB for presence/signaling/metadata and
// Firebase Storage for file & voice media (replaces base64-in-DB).

import { initializeApp } from 'firebase/app'
import { getDatabase, ref, onValue, onDisconnect, set, remove, serverTimestamp } from 'firebase/database'
import { getStorage } from 'firebase/storage'
import { FIREBASE_CONFIG } from './config.js'
import { state, emit } from './state.js'
import { el, formatPasskey } from './ui.js'

const app = initializeApp(FIREBASE_CONFIG)

export const db = getDatabase(app)
export const storage = getStorage(app)

const roomPath = (passkey = state.passkey) => `prichat_rooms/${passkey}`

// Monitor Active Passkey Channels on Landing
export function monitorActiveRooms() {
  onValue(ref(db, 'prichat_rooms'), (snapshot) => {
    const rooms = snapshot.val() || {}
    el.activeRoomsList.innerHTML = ''
    const roomKeys = Object.keys(rooms)
    el.channelCountBadge.innerText = `${roomKeys.length} ACTIVE`

    if (roomKeys.length === 0) {
      el.activeRoomsList.innerHTML = `<div class="text-xs font-mono text-stealth-500 text-center py-4">No active passkey channels. Enter key to launch one.</div>`
      return
    }

    roomKeys.forEach(k => {
      const room = rooms[k]
      const peerCount = room.peers ? Object.keys(room.peers).length : 0
      const div = document.createElement('div')
      div.className = 'flex items-center justify-between p-2.5 rounded-xl bg-stealth-900 border border-stealth-800 hover:border-stealth-700 cursor-pointer transition-all'
      div.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${peerCount >= 2 ? 'bg-amber-500' : 'bg-emerald-500'}"></span>
          <span class="font-mono text-xs text-stealth-200">KEY: ${formatPasskey(k)}</span>
        </div>
        <span class="text-[10px] font-mono text-stealth-400">${peerCount}/2 OPERATORS</span>
      `
      div.addEventListener('click', () => {
        for (let i = 0; i < 6; i++) {
          el.pinInputs[i].value = k[i] || ''
        }
        document.getElementById('btn-connect').disabled = k.length !== 6
      })
      el.activeRoomsList.appendChild(div)
    })
  })
}

let peerOff = null

// Connect / Launch Channel — registers presence & watches for the other peer
export function joinChannel(passkey) {
  state.passkey = passkey

  const myPeerRef = ref(db, `${roomPath(passkey)}/peers/${state.userId}`)
  set(myPeerRef, {
    alias: state.alias,
    joinedAt: serverTimestamp()
  })
  onDisconnect(myPeerRef).remove()

  if (peerOff) peerOff()
  peerOff = onValue(ref(db, `${roomPath(passkey)}/peers`), (snapshot) => {
    const peers = snapshot.val() || {}
    const peerIds = Object.keys(peers).filter(id => id !== state.userId)

    if (peerIds.length > 0) {
      const otherPeer = peers[peerIds[0]]
      el.peerStatusLabel.innerText = `LINKED WITH ${otherPeer.alias.toUpperCase()} • E2E SYNC`
      el.peerStatusLabel.classList.remove('text-stealth-400')
      el.peerStatusLabel.classList.add('text-emerald-400')
      state.peerOnline = true
    } else {
      el.peerStatusLabel.innerText = 'WAITING FOR SECOND OPERATOR...'
      el.peerStatusLabel.classList.remove('text-emerald-400')
      el.peerStatusLabel.classList.add('text-stealth-400')
      state.peerOnline = false
    }
    emit('presence', { online: state.peerOnline })
  })
}

// Disconnect & Leave
export function leaveChannel() {
  if (peerOff) {
    peerOff()
    peerOff = null
  }
  if (state.passkey) {
    remove(ref(db, `${roomPath()}/peers/${state.userId}`)).catch(() => {})
    remove(ref(db, `${roomPath()}/typing/${state.userId}`)).catch(() => {})
  }
  state.peerOnline = false
  state.passkey = ''
}