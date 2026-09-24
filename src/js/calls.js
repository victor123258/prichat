// ==================== WEBRTC AUDIO/VIDEO CALL SIGNALING ENGINE ====================
// Direct P2P media via WebRTC; signaling rides over the Firebase room.

import { db } from './db.js'
import { ref, onValue, onChildAdded, push, set } from 'firebase/database'
import { RTC_CONFIG } from './config.js'
import { state } from './state.js'
import { el, showToast, playBlip } from './ui.js'

const roomPath = () => `prichat_rooms/${state.passkey}`

let callSigOff = null
const candOffs = []

export function startCallListeners() {
  stopCallListeners()

  callSigOff = onValue(ref(db, `${roomPath()}/call_signal`), handleCallSignal)

  // Consume ICE candidates pushed by the peer (candidates are keyed by userId)
  onChildAdded(ref(db, `${roomPath()}/candidates`), (snap) => {
    if (!snap.key || snap.key === state.userId) return
    const off = onChildAdded(snap.ref, (cs) => {
      const cand = cs.val()
      if (state.peerConnection && cand) {
        try {
          state.peerConnection.addIceCandidate(new RTCIceCandidate(cand))
        } catch (e) { /* ignore bad candidate */ }
      }
    })
    candOffs.push(off)
  })
}

export function stopCallListeners() {
  if (callSigOff) callSigOff()
  candOffs.forEach(off => off())
  candOffs.length = 0
  callSigOff = null
}

async function handleCallSignal(snapshot) {
  const signal = snapshot.val()
  if (!signal) return

  if (signal.type === 'offer' && signal.callerId !== state.userId) {
    // Incoming Call Prompt
    state.pendingOfferSignal = signal
    el.incomingCallerId.innerText = signal.callerAlias + ' IS CALLING'
    el.incomingCallType.innerText = `Encrypted ${signal.callType.toUpperCase()} Request`
    el.incomingCallModal.classList.remove('hidden')
    playSynthesizedRingtone()
  } else if (signal.type === 'answer' && signal.targetId === state.userId) {
    // Peer Accepted Answer
    if (state.peerConnection) {
      try {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.answer))
      } catch (e) { /* ignore */ }
    }
  } else if (signal.type === 'end') {
    const modalOpen = !el.incomingCallModal.classList.contains('hidden')
    const isInCall = state.activeCallType !== null
    endCallLocally()
    if (modalOpen && !isInCall) {
      // The peer hung up while we were still viewing the incoming prompt → missed call
      if (!el.decoyScreen.classList.contains('hidden')) return
      playBlip(392, 0.1)
      showToast('Missed call from ' + (state.pendingOfferSignal?.callerAlias || 'peer'), '📞')
      el.btnSoundNotification.classList.add('ring-2', 'ring-red-500')
      setTimeout(() => el.btnSoundNotification.classList.remove('ring-2', 'ring-red-500'), 4000)
      try { navigator.vibrate && navigator.vibrate([200, 100, 200]) } catch (e) { /* ignore */ }
    }
  }
}

function createPeerConnection() {
  state.peerConnection = new RTCPeerConnection(RTC_CONFIG)

  state.peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      push(ref(db, `${roomPath()}/candidates/${state.userId}`), event.candidate.toJSON()).catch(() => {})
    }
  }

  state.peerConnection.ontrack = (event) => {
    el.remoteVideo.srcObject = event.streams[0]
  }
}

// Start Voice/Video Call
export async function initCall(type) {
  state.activeCallType = type
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === 'video'
    })
    el.localVideo.srcObject = state.localStream
    el.videoCallStage.classList.remove('hidden')

    createPeerConnection()

    state.localStream.getTracks().forEach(track => {
      state.peerConnection.addTrack(track, state.localStream)
    })

    const offer = await state.peerConnection.createOffer()
    await state.peerConnection.setLocalDescription(offer)

    // Send Call Signal offer over Firebase
    await set(ref(db, `${roomPath()}/call_signal`), {
      type: 'offer',
      offer: { type: offer.type, sdp: offer.sdp },
      callerAlias: state.alias,
      callType: type,
      callerId: state.userId
    })

    startCallTimer()
  } catch (err) {
    showToast('Failed to access AV devices: ' + err.message, '⚠️')
  }
}

// Accept Incoming Call
el.btnAcceptCall.addEventListener('click', async () => {
  stopSynthesizedRingtone()
  el.incomingCallModal.classList.add('hidden')

  const signal = state.pendingOfferSignal
  if (!signal) return
  state.activeCallType = signal.callType

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: signal.callType === 'video'
    })
    el.localVideo.srcObject = state.localStream
    el.videoCallStage.classList.remove('hidden')

    createPeerConnection()

    state.localStream.getTracks().forEach(track => {
      state.peerConnection.addTrack(track, state.localStream)
    })

    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.offer))
    const answer = await state.peerConnection.createAnswer()
    await state.peerConnection.setLocalDescription(answer)

    await set(ref(db, `${roomPath()}/call_signal`), {
      type: 'answer',
      answer: { type: answer.type, sdp: answer.sdp },
      targetId: signal.callerId
    })

    startCallTimer()
  } catch (err) {
    console.error(err)
    showToast('Failed to connect call', '⚠️')
  }
})

// Decline Incoming Call
el.btnDeclineCall.addEventListener('click', () => {
  stopSynthesizedRingtone()
  el.incomingCallModal.classList.add('hidden')
  if (state.passkey) {
    set(ref(db, `${roomPath()}/call_signal`), { type: 'end' }).catch(() => {})
  }
})

// End Call
el.btnStartAudioCall.addEventListener('click', () => initCall('audio'))
el.btnStartVideoCall.addEventListener('click', () => initCall('video'))

el.btnEndCall.addEventListener('click', () => {
  if (state.passkey) {
    set(ref(db, `${roomPath()}/call_signal`), { type: 'end' }).catch(() => {})
  }
  endCallLocally()
})

function endCallLocally() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop())
  }
  if (state.peerConnection) {
    state.peerConnection.close()
    state.peerConnection = null
  }
  el.videoCallStage.classList.add('hidden')
  clearInterval(state.callTimerInterval)
  state.activeCallType = null
  showToast('Call Ended')
}

// Mute & Camera Controls
el.btnToggleMic.addEventListener('click', () => {
  if (state.localStream) {
    const audioTrack = state.localStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      el.btnToggleMic.classList.toggle('bg-red-600', !audioTrack.enabled)
    }
  }
})

el.btnToggleCam.addEventListener('click', () => {
  if (state.localStream) {
    const videoTrack = state.localStream.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled
      el.btnToggleCam.classList.toggle('bg-red-600', !videoTrack.enabled)
    }
  }
})

function startCallTimer() {
  let seconds = 0
  const timerEl = document.getElementById('call-timer')
  clearInterval(state.callTimerInterval)
  state.callTimerInterval = setInterval(() => {
    seconds++
    const m = String(Math.floor(seconds / 60)).padStart(2, '0')
    const s = String(seconds % 60).padStart(2, '0')
    timerEl.innerText = `${m}:${s} • E2E STREAM ACTIVE`
  }, 1000)
}

// Synthesized Web Audio API Ringtone
let audioCtx, ringOscillator
function playSynthesizedRingtone() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    ringOscillator = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    ringOscillator.type = 'sine'
    ringOscillator.frequency.setValueAtTime(440, audioCtx.currentTime)
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime)
    ringOscillator.connect(gain)
    gain.connect(audioCtx.destination)
    ringOscillator.start()
  } catch (e) { /* ignore */ }
}

function stopSynthesizedRingtone() {
  if (ringOscillator) {
    try { ringOscillator.stop() } catch (e) { /* ignore */ }
  }
}