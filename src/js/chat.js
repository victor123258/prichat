// ==================== MESSAGING, FILE & VOICE NOTE ENGINE ====================

import { db, storage } from './db.js'
import { ref, onValue, onChildAdded, push, set, remove, serverTimestamp } from 'firebase/database'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { MAX_FILE_BYTES } from './config.js'
import { state } from './state.js'
import { el, showToast, escapeHtml } from './ui.js'

const roomPath = () => `prichat_rooms/${state.passkey}`

const WELCOME_HTML = `
  <div id="chat-welcome" class="my-6 text-center">
    <div class="inline-block p-4 rounded-2xl bg-stealth-900 border border-stealth-800 max-w-xs text-center">
      <div class="text-xs font-mono text-stealth-200 font-semibold mb-1">STEALTH CHANNEL ESTABLISHED</div>
      <p class="text-[11px] font-mono text-stealth-400 leading-relaxed">Share 6-digit key with peer. All messages, voice notes, and calls are direct end-to-end synchronized.</p>
    </div>
  </div>`

let msgOff = null
let typingOff = null

export function startChatListeners() {
  stopChatListeners()
  resetChatUI()

  msgOff = onChildAdded(ref(db, `${roomPath()}/messages`), (snapshot) => {
    renderMessage(snapshot.val())
  })

  typingOff = onValue(ref(db, `${roomPath()}/typing`), (snapshot) => {
    const typingObj = snapshot.val() || {}
    const isOtherTyping = Object.keys(typingObj).some(id => id !== state.userId)
    el.typingIndicator.classList.toggle('opacity-0', !isOtherTyping)
  })
}

export function stopChatListeners() {
  if (msgOff) msgOff()
  if (typingOff) typingOff()
  msgOff = null
  typingOff = null
}

function resetChatUI() {
  el.messagesContainer.innerHTML = ''
  el.messagesContainer.insertAdjacentHTML('afterbegin', WELCOME_HTML)
  el.typingIndicator.classList.add('opacity-0')
}

// Render Chat Message Bubble
function renderMessage(msg) {
  const welcome = document.getElementById('chat-welcome')
  if (welcome) welcome.remove()

  const isMine = msg.senderId === state.userId
  const row = document.createElement('div')
  row.className = `flex flex-col ${isMine ? 'items-end' : 'items-start'} mb-3`

  let contentHtml = ''

  if (msg.type === 'text') {
    contentHtml = `<div class="text-xs font-mono leading-relaxed break-words">${escapeHtml(msg.text)}</div>`
  } else if (msg.type === 'image') {
    contentHtml = `
      <img src="${escapeHtml(msg.fileUrl)}" alt="Shared image" class="max-w-xs max-h-60 rounded-xl border border-stealth-700 object-cover mb-1 cursor-pointer" onclick="window.open('${escapeHtml(msg.fileUrl)}', '_blank')">
      <div class="text-[10px] font-mono opacity-60">${escapeHtml(msg.fileName || 'Image')}</div>
    `
  } else if (msg.type === 'file') {
    contentHtml = `
      <div class="flex items-center gap-3 p-2 rounded-xl bg-stealth-900 border border-stealth-700 min-w-[200px]">
        <span class="text-xl">📁</span>
        <div class="flex-1 min-w-0 text-left">
          <div class="text-xs font-mono font-semibold text-stealth-200 truncate">${escapeHtml(msg.fileName)}</div>
          <div class="text-[10px] font-mono text-stealth-400">${escapeHtml(msg.fileSize)}</div>
        </div>
        <a href="${escapeHtml(msg.fileUrl)}" download="${escapeHtml(msg.fileName)}" target="_blank" rel="noopener" class="p-2 rounded-lg bg-stealth-800 text-stealth-200 hover:text-white">⬇️</a>
      </div>
    `
  } else if (msg.type === 'voice') {
    contentHtml = `
      <div class="flex items-center gap-3 p-2 rounded-xl bg-stealth-900 border border-stealth-700 min-w-[180px]">
        <button onclick="this.nextElementSibling.play()" class="p-2.5 rounded-full bg-stealth-200 text-stealth-950 font-bold">▶</button>
        <audio src="${escapeHtml(msg.audioUrl)}" class="hidden"></audio>
        <div class="flex-1">
          <div class="h-4 bg-stealth-800 rounded flex items-center gap-0.5 px-1">
            <span class="w-1 h-2 bg-stealth-400 rounded-full animate-pulse"></span>
            <span class="w-1 h-3 bg-stealth-400 rounded-full"></span>
            <span class="w-1 h-1 bg-stealth-400 rounded-full"></span>
            <span class="w-1 h-4 bg-stealth-400 rounded-full"></span>
            <span class="w-1 h-2 bg-stealth-400 rounded-full"></span>
          </div>
          <div class="text-[9px] font-mono text-stealth-400 mt-1">VOICE NOTE • ${escapeHtml(msg.duration || '0:03')}</div>
        </div>
      </div>
    `
  }

  const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  row.innerHTML = `
    <div class="text-[9px] font-mono text-stealth-500 mb-0.5 px-1">${escapeHtml(msg.senderAlias)} • ${timeStr}</div>
    <div class="max-w-[82%] p-3 rounded-2xl ${isMine ? 'bg-stealth-200 text-stealth-950 rounded-br-none' : 'bg-stealth-850 text-stealth-100 border border-stealth-800 rounded-bl-none'} shadow-md">
      ${contentHtml}
    </div>
  `

  el.messagesContainer.appendChild(row)
  el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight
}

// Send Text Message
export function sendMessage() {
  const text = el.chatInput.value.trim()

  // Handle Pending File Send
  if (state.selectedFile) {
    sendFileMessage(state.selectedFile)
    return
  }

  if (!text || !state.passkey) return

  push(ref(db, `${roomPath()}/messages`), {
    senderId: state.userId,
    senderAlias: state.alias,
    type: 'text',
    text,
    timestamp: serverTimestamp()
  }).catch(() => showToast('Failed to send message', '⚠️'))

  el.chatInput.value = ''
}

// File Attachment Previews + Firebase Storage Upload
el.btnAttachFile.addEventListener('click', () => el.fileInput.click())

el.fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (!file) return

  if (file.size > MAX_FILE_BYTES) {
    showToast('File exceeds 10MB limit', '⚠️')
    e.target.value = ''
    return
  }

  state.selectedFile = file
  el.previewFilename.innerText = file.name
  el.previewFilesize.innerText = (file.size / 1024).toFixed(1) + ' KB'
  el.filePreviewBar.classList.remove('hidden')
})

el.btnCancelFile.addEventListener('click', () => {
  state.selectedFile = null
  el.fileInput.value = ''
  el.filePreviewBar.classList.add('hidden')
})

async function sendFileMessage(file) {
  showToast('Uploading to secure storage...', '📤')
  try {
    const safeName = file.name.replace(/[^\w.\- ]/g, '_')
    const path = `rooms/${state.passkey}/media/${Date.now()}_${state.userId}_${safeName}`
    const snap = await uploadBytes(storageRef(storage, path), file)
    const fileUrl = await getDownloadURL(snap.ref)
    const isImage = file.type.startsWith('image/')

    await push(ref(db, `${roomPath()}/messages`), {
      senderId: state.userId,
      senderAlias: state.alias,
      type: isImage ? 'image' : 'file',
      fileUrl,
      fileName: file.name,
      fileSize: (file.size / 1024).toFixed(1) + ' KB',
      timestamp: serverTimestamp()
    })

    state.selectedFile = null
    el.fileInput.value = ''
    el.filePreviewBar.classList.add('hidden')
  } catch (err) {
    console.error(err)
    showToast('Upload failed — check Firebase Storage rules', '⚠️')
  }
}

// Voice Note Recorder (MediaRecorder API → Firebase Storage)
el.btnRecordVoice.addEventListener('click', toggleVoiceRecord)

async function toggleVoiceRecord() {
  if (!state.isRecordingVoice) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      state.mediaRecorder = new MediaRecorder(stream)
      state.audioChunks = []
      state.voiceStart = Date.now()

      state.mediaRecorder.ondataavailable = e => state.audioChunks.push(e.data)
      state.mediaRecorder.onstop = sendVoiceNote

      state.mediaRecorder.start()
      state.isRecordingVoice = true
      el.btnRecordVoice.classList.add('recording-indicator', 'text-red-400')
      showToast('Recording Voice Note...', '🎙️')
    } catch {
      showToast('Microphone Permission Denied', '⚠️')
    }
  } else if (state.mediaRecorder) {
    state.mediaRecorder.stop()
    state.isRecordingVoice = false
    el.btnRecordVoice.classList.remove('recording-indicator', 'text-red-400')
    state.mediaRecorder.stream.getTracks().forEach(t => t.stop())
  }
}

async function sendVoiceNote() {
  const blob = new Blob(state.audioChunks, { type: 'audio/webm' })
  const duration = Math.max(1, Math.round((Date.now() - state.voiceStart) / 1000))

  try {
    const path = `rooms/${state.passkey}/voice/${Date.now()}_${state.userId}.webm`
    const snap = await uploadBytes(storageRef(storage, path), blob)
    const audioUrl = await getDownloadURL(snap.ref)

    await push(ref(db, `${roomPath()}/messages`), {
      senderId: state.userId,
      senderAlias: state.alias,
      type: 'voice',
      audioUrl,
      duration: duration + 's',
      timestamp: serverTimestamp()
    })
  } catch (err) {
    console.error(err)
    showToast('Voice upload failed — check Firebase Storage rules', '⚠️')
  }
}

// Quick Emoji Buttons
document.querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    el.chatInput.value += btn.innerText
    el.chatInput.focus()
  })
})

// Send triggers
el.btnSendMsg.addEventListener('click', sendMessage)
el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

// Typing Sync
el.chatInput.addEventListener('input', () => {
  if (!state.passkey) return
  set(ref(db, `${roomPath()}/typing/${state.userId}`), true).catch(() => {})
  clearTimeout(state.typingTimeout)
  state.typingTimeout = setTimeout(() => {
    remove(ref(db, `${roomPath()}/typing/${state.userId}`)).catch(() => {})
  }, 2000)
})