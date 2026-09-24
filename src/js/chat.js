// ==================== MESSAGING, FILE & VOICE NOTE ENGINE ====================
// History window + load-earlier, edit/delete/reply, read receipts,
// incoming-message notifications & image lightbox delegation.

import { db, storage } from './db.js'
import {
  ref, onValue, onChildAdded, onChildChanged, onChildRemoved,
  push, set, update, remove, serverTimestamp
} from 'firebase/database'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { MAX_FILE_BYTES } from './config.js'
import { state, on } from './state.js'
import { el, showToast, escapeHtml, playBlip, openLightbox } from './ui.js'

const roomPath = () => `prichat_rooms/${state.passkey}`

const WELCOME_HTML = `
  <div id="chat-welcome" class="my-6 text-center">
    <div class="inline-block p-4 rounded-2xl bg-stealth-900 border border-stealth-800 max-w-xs text-center">
      <div class="text-xs font-mono text-stealth-200 font-semibold mb-1">STEALTH CHANNEL ESTABLISHED</div>
      <p class="text-[11px] font-mono text-stealth-400 leading-relaxed">Share 6-digit key with peer. All messages, voice notes, and calls are direct end-to-end synchronized.</p>
    </div>
  </div>`

let msgOff = null, changedOff = null, removedOff = null, typingOff = null, readOff = null
let unsubPresence = null
let flushTimer = null

export function startChatListeners() {
  stopChatListeners()
  resetChatUI()

  const messagesRef = ref(db, `${roomPath()}/messages`)

  msgOff = onChildAdded(messagesRef, (snap) => scheduleUpsert(snap.key, snap.val()))
  changedOff = onChildChanged(messagesRef, (snap) => onEntryChanged(snap.key, snap.val()))
  removedOff = onChildRemoved(messagesRef, (snap) => onEntryRemoved(snap.key))

  typingOff = onValue(ref(db, `${roomPath()}/typing`), (snapshot) => {
    const typingObj = snapshot.val() || {}
    const isOtherTyping = Object.keys(typingObj).some(id => id !== state.userId)
    el.typingIndicator.classList.toggle('opacity-0', !isOtherTyping)
  })

  // Read receipts — only the peer's last-seen timestamp (ignore stale own-session ids)
  readOff = onValue(ref(db, `${roomPath()}/read`), (snapshot) => {
    const read = snapshot.val() || {}
    state.peerReadTs = state.peerId ? (Math.max(0, read[state.peerId] || 0)) : 0
    refreshTicks()
  })

  unsubPresence = on('presence', () => refreshTicks())
}

export function stopChatListeners() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (msgOff) msgOff()
  if (changedOff) changedOff()
  if (removedOff) removedOff()
  if (typingOff) typingOff()
  if (readOff) readOff()
  if (unsubPresence) unsubPresence()
  msgOff = changedOff = removedOff = typingOff = readOff = null
  unsubPresence = null
}

function resetChatUI() {
  state.messages = []
  state.renderStart = 0
  state.visibleCount = 50
  state.replayDone = false
  state.peerReadTs = 0
  state.lastMarkedRead = 0
  state.replyTo = null

  el.messagesContainer.innerHTML = ''
  el.messagesContainer.insertAdjacentHTML('afterbegin', WELCOME_HTML)
  el.typingIndicator.classList.add('opacity-0')
  hideReplyBar()
}

/* ---------------------- ingesting / replay window ---------------------- */

function scheduleUpsert(key, msg) {
  if (!msg || state.messages.some(m => m.key === key)) return
  state.messages.push({ key, ...msg })

  // Batch the initial history replay into one render pass.
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (!state.replayDone) {
      state.replayDone = true
      markAllRead()
      renderWindow(true)
    }
  }, 150)

  if (state.replayDone) {
    appendIfVisible(state.messages[state.messages.length - 1])
    if (msg.senderId !== state.userId) {
      notifyIncoming(msg)
      markRead(msg)
    }
  }
}

function onEntryChanged(key, msg) {
  const entry = state.messages.find(m => m.key === key)
  if (!entry) return
  Object.assign(entry, msg)
  const row = el.messagesContainer.querySelector(`.msg-wrap[data-key="${key}"]`)
  if (row) {
    const replacement = createRow(entry)
    row.replaceWith(replacement)
    refreshTicksFor(replacement)
  }
}

function onEntryRemoved(key) {
  const idx = state.messages.findIndex(m => m.key === key)
  if (idx >= 0) state.messages.splice(idx, 1)
  const row = el.messagesContainer.querySelector(`.msg-wrap[data-key="${key}"]`)
  if (row) row.remove()

  if (state.messages.length === 0) {
    state.renderStart = 0
    renderWindow(true)
    return
  }
  if (state.renderStart > state.messages.length) {
    state.renderStart = Math.max(0, state.messages.length - state.visibleCount)
  }
  const btn = el.messagesContainer.querySelector('#load-earlier')
  if (btn && state.renderStart <= 0) btn.remove()
}

function markRead(msg) {
  const ts = typeof msg.timestamp === 'number' ? msg.timestamp : 0
  if (ts > (state.lastMarkedRead || 0)) {
    state.lastMarkedRead = ts
    set(ref(db, `${roomPath()}/read/${state.userId}`), ts).catch(() => {})
  }
}

function markAllRead() {
  let maxTs = 0
  state.messages.forEach(m => {
    if (typeof m.timestamp === 'number') maxTs = Math.max(maxTs, m.timestamp)
  })
  if (maxTs > (state.lastMarkedRead || 0)) {
    state.lastMarkedRead = maxTs
    set(ref(db, `${roomPath()}/read/${state.userId}`), maxTs).catch(() => {})
  }
}

function renderWindow(scrollBottom) {
  const container = el.messagesContainer
  const total = state.messages.length

  if (total === 0) {
    container.innerHTML = WELCOME_HTML
    return
  }

  state.renderStart = Math.max(0, total - state.visibleCount)

  const frag = document.createDocumentFragment()
  if (state.renderStart > 0) {
    frag.appendChild(buildLoadEarlierBtn())
  }
  for (let i = state.renderStart; i < total; i++) {
    frag.appendChild(createRow(state.messages[i]))
  }
  container.replaceChildren(frag)

  if (scrollBottom) container.scrollTop = container.scrollHeight
  refreshTicks()
}

function appendIfVisible(entry) {
  const container = el.messagesContainer
  const idx = state.messages.indexOf(entry)
  if (idx < state.renderStart) return

  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
  const row = createRow(entry)
  container.appendChild(row)

  // Keep the rendered window capped.
  while (container.querySelectorAll('.msg-wrap').length > state.visibleCount) {
    const first = container.querySelector('.msg-wrap')
    if (!first) break
    first.remove()
    state.renderStart++
  }

  if (nearBottom || entry.senderId === state.userId) {
    container.scrollTop = container.scrollHeight
  }
  refreshTicksFor(row)
}

function loadEarlier() {
  if (state.renderStart <= 0) return
  const container = el.messagesContainer
  const prevHeight = container.scrollHeight
  const prevTop = container.scrollTop
  state.visibleCount += 50
  renderWindow(false)
  container.scrollTop = prevTop + (container.scrollHeight - prevHeight)
}

function buildLoadEarlierBtn() {
  const btn = document.createElement('button')
  btn.id = 'load-earlier'
  btn.className = 'load-earlier'
  btn.dataset.action = 'load-earlier'
  btn.textContent = 'LOAD EARLIER MESSAGES'
  return btn
}

/* ---------------------- row rendering ---------------------- */

function contentFor(m) {
  if (m.type === 'text') {
    return `<div class="text-xs font-mono leading-relaxed break-words">${escapeHtml(m.text)}</div>`
  }
  if (m.type === 'image') {
    return `
      <img class="msg-image max-w-[240px] max-h-60 rounded-xl border border-stealth-700 object-cover cursor-zoom-in" data-full="${escapeHtml(m.fileUrl)}" src="${escapeHtml(m.fileUrl)}" alt="Shared image">
      <div class="text-[10px] font-mono opacity-60 mt-1">${escapeHtml(m.fileName || 'Image')}</div>
    `
  }
  if (m.type === 'file') {
    return `
      <div class="flex items-center gap-3 p-2 rounded-xl bg-stealth-900 border border-stealth-700 min-w-[200px]">
        <span class="text-xl">📁</span>
        <div class="flex-1 min-w-0 text-left">
          <div class="text-xs font-mono font-semibold text-stealth-200 truncate">${escapeHtml(m.fileName)}</div>
          <div class="text-[10px] font-mono text-stealth-400">${escapeHtml(m.fileSize)}</div>
        </div>
        <a href="${escapeHtml(m.fileUrl)}" download="${escapeHtml(m.fileName)}" target="_blank" rel="noopener" class="p-2 rounded-lg bg-stealth-800 text-stealth-200 hover:text-white">⬇️</a>
      </div>
    `
  }
  if (m.type === 'voice') {
    return `
      <div class="flex items-center gap-3 p-2 rounded-xl bg-stealth-900 border border-stealth-700 min-w-[180px]">
        <button onclick="this.nextElementSibling.play()" class="p-2.5 rounded-full bg-stealth-200 text-stealth-950 font-bold">▶</button>
        <audio src="${escapeHtml(m.audioUrl)}" class="hidden"></audio>
        <div class="flex-1">
          <div class="h-4 bg-stealth-800 rounded flex items-center gap-0.5 px-1">
            <span class="w-1 h-2 bg-stealth-400 rounded-full animate-pulse"></span>
            <span class="w-1 h-3 bg-stealth-400 rounded-full"></span>
            <span class="w-1 h-1 bg-stealth-400 rounded-full"></span>
            <span class="w-1 h-4 bg-stealth-400 rounded-full"></span>
            <span class="w-1 h-2 bg-stealth-400 rounded-full"></span>
          </div>
          <div class="text-[9px] font-mono text-stealth-400 mt-1">VOICE NOTE • ${escapeHtml(m.duration || '0:03')}</div>
        </div>
      </div>
    `
  }
  return '<div class="text-xs font-mono italic opacity-60">Message deleted</div>'
}

function createRow(m) {
  const isMine = m.senderId === state.userId
  const isEdited = m.type === 'text' && m.edited

  const wrap = document.createElement('div')
  wrap.className = `msg-wrap flex items-end gap-1.5 mb-3 ${isMine ? 'justify-end' : ''}`
  wrap.dataset.key = m.key
  wrap.dataset.mine = isMine ? '1' : '0'
  wrap.dataset.ts = String(typeof m.timestamp === 'number' ? m.timestamp : '')

  const col = document.createElement('div')
  col.className = `flex flex-col ${isMine ? 'items-end' : 'items-start'} max-w-[85%]`

  const timeStr = m.timestamp
    ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '···'

  const meta = document.createElement('div')
  meta.className = 'text-[9px] font-mono text-stealth-500 mb-0.5 px-1'
  meta.innerHTML = `${escapeHtml(m.senderAlias || '')} • ${timeStr}` +
    (isMine ? '<span class="msg-tick" data-tick></span>' : '') +
    (isEdited ? '<span class="edited-tag">edited</span>' : '')

  let bubbleClass = 'msg-bubble p-3 rounded-2xl text-stone-50'
  if (m.type === 'deleted') {
    bubbleClass = 'msg-bubble p-3 rounded-2xl bg-stealth-850 border border-stealth-800 italic opacity-60 text-xs font-mono'
  } else if (isMine) {
    bubbleClass = 'msg-bubble p-3 rounded-2xl bg-stealth-200 text-stealth-950 rounded-br-none shadow-md'
  } else {
    bubbleClass = 'msg-bubble p-3 rounded-2xl bg-stealth-850 text-stealth-100 border border-stealth-800 rounded-bl-none shadow-md'
  }

  const bubble = document.createElement('div')
  bubble.className = bubbleClass
  bubble.dataset.role = 'bubble'

  let contentHtml = ''
  if (m.reply) {
    contentHtml += `
      <div class="reply-quote">
        <div class="rq-alias">${escapeHtml(m.reply.alias)}</div>
        <div class="rq-text">${escapeHtml(m.reply.text)}</div>
      </div>`
  }
  contentHtml += contentFor(m)
  bubble.innerHTML = contentHtml

  col.appendChild(meta)
  col.appendChild(bubble)

  const actions = document.createElement('div')
  actions.className = 'msg-actions flex flex-col gap-1 pb-4'
  actions.innerHTML = `
    <button data-action="reply" title="Reply">↩</button>
    ${isMine && m.type === 'text' ? '<button data-action="edit" title="Edit">✎</button>' : ''}
    ${isMine ? '<button class="danger" data-action="delete" title="Delete for both">✕</button>' : ''}
  `

  wrap.appendChild(col)
  wrap.appendChild(actions)
  return wrap
}

function refreshTicksFor(row) {
  if (!row || row.dataset.mine !== '1') return
  const tick = row.querySelector('[data-tick]')
  const ts = Number(row.dataset.ts || 0)
  if (!tick) return
  if (state.peerReadTs >= ts && ts > 0) {
    tick.textContent = '✓✓'
    tick.className = 'msg-tick read'
  } else if (state.peerOnline) {
    tick.textContent = '✓✓'
    tick.className = 'msg-tick delivered'
  } else {
    tick.textContent = '✓'
    tick.className = 'msg-tick'
  }
}

function refreshTicks() {
  el.messagesContainer.querySelectorAll('.msg-wrap[data-mine="1"]').forEach(refreshTicksFor)
}

/* ---------------------- delegation: lightbox, load-earlier, actions ---------------------- */

el.messagesContainer.addEventListener('click', onContainerClick)
el.messagesContainer.addEventListener('scroll', () => {
  if (el.messagesContainer.scrollTop < 24 && state.renderStart > 0) loadEarlier()
})

function onContainerClick(e) {
  // Image → lightbox
  const img = e.target.closest('.msg-image')
  if (img) {
    openLightbox(img.dataset.full || img.src)
    return
  }

  // Load-earlier
  if (e.target.closest('[data-action="load-earlier"]')) {
    loadEarlier()
    return
  }

  // Inline-edit buttons
  const editBtn = e.target.closest('[data-edit]')
  if (editBtn) {
    handleInlineEdit(e, editBtn.dataset.edit)
    return
  }

  // Row actions
  const btn = e.target.closest('[data-action]')
  if (!btn) return
  const wrap = btn.closest('.msg-wrap')
  if (!wrap) return
  const m = state.messages.find(x => x.key === wrap.dataset.key)
  if (!m) return

  const action = btn.dataset.action
  if (action === 'reply') {
    const preview = m.type === 'text' ? m.text
      : m.type === 'voice' ? 'Voice note'
      : m.fileName || 'File'
    state.replyTo = { key: m.key, alias: m.senderAlias, text: preview }
    renderReplyBar()
  } else if (action === 'edit') {
    startInlineEdit(wrap, m)
  } else if (action === 'delete') {
    if (confirm('Delete this message for both operators?')) {
      remove(ref(db, `${roomPath()}/messages/${m.key}`)).catch(() => showToast('Delete failed', '⚠️'))
    }
  }
}

/* ---------------------- inline edit ---------------------- */

function startInlineEdit(wrap, m) {
  const bubble = wrap.querySelector('[data-role="bubble"]')
  const current = m.text || ''
  bubble.innerHTML = `
    <textarea class="edit-input w-full bg-stealth-900 border border-stealth-700 rounded-xl px-2 py-1.5 text-xs font-mono text-stealth-100 resize-none" rows="2">${escapeHtml(current)}</textarea>
    <div class="flex gap-2 mt-1.5 justify-end">
      <button data-edit="cancel" class="edit-btn">CANCEL</button>
      <button data-edit="save" class="edit-btn save">SAVE</button>
    </div>`
  const ta = bubble.querySelector('textarea')
  ta.focus()
  ta.setSelectionRange(ta.value.length, ta.value.length)
}

function handleInlineEdit(e, mode) {
  const btn = e.target.closest('[data-edit]')
  const wrap = btn.closest('.msg-wrap')
  const bubble = wrap.querySelector('[data-role="bubble"]')
  const m = state.messages.find(x => x.key === wrap.dataset.key)
  if (!m) return

  if (mode === 'save') {
    const text = bubble.querySelector('textarea').value.trim()
    if (text && text !== m.text) {
      update(ref(db, `${roomPath()}/messages/${m.key}`), { text, edited: true })
        .catch(() => showToast('Edit failed', '⚠️'))
    }
  }
  // Re-render the row (cancels edits / shows saved result via local refresh)
  bubble.innerHTML = ''
  const replacement = createRow(m)
  wrap.replaceWith(replacement)
  refreshTicksFor(replacement)
}

/* ---------------------- reply compose bar ---------------------- */

function renderReplyBar() {
  if (!state.replyTo) return
  el.replyBarAlias.textContent = 'REPLYING TO ' + state.replyTo.alias.toUpperCase()
  el.replyBarText.textContent = state.replyTo.text
  el.replyBar.classList.remove('hidden')
  el.chatInput.focus()
}

function hideReplyBar() {
  state.replyTo = null
  el.replyBar.classList.add('hidden')
}

el.btnCancelReply.addEventListener('click', hideReplyBar)

/* ---------------------- sending ---------------------- */

export function sendMessage() {
  const text = el.chatInput.value.trim()

  if (state.selectedFile) {
    const file = state.selectedFile
    state.selectedFile = null
    el.filePreviewBar.classList.add('hidden')
    el.fileInput.value = ''
    el.chatInput.value = ''
    sendFileMessage(file)
    return
  }

  if (!text || !state.passkey) return

  const payload = {
    senderId: state.userId,
    senderAlias: state.alias,
    type: 'text',
    text,
    timestamp: serverTimestamp()
  }
  if (state.replyTo) payload.reply = { alias: state.replyTo.alias, text: state.replyTo.text, senderId: state.userId }

  push(ref(db, `${roomPath()}/messages`), payload).catch(() => showToast('Failed to send message', '⚠️'))

  el.chatInput.value = ''
  if (state.replyTo) hideReplyBar()
}

/* ---------------------- file & voice uploads ---------------------- */

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
  } catch (err) {
    console.error(err)
    showToast('Upload failed — check Firebase Storage rules', '⚠️')
  }
}

/* ---------------------- voice notes ---------------------- */

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

/* ---------------------- incoming notifications ---------------------- */

function notifyIncoming(m) {
  if (el.decoyScreen && !el.decoyScreen.classList.contains('hidden')) return

  const text = m.type === 'text' ? m.text
    : m.type === 'voice' ? 'Voice note'
    : m.type === 'image' ? (m.fileName || 'Image')
    : m.type === 'file' ? (m.fileName || 'File')
    : 'New message'

  playBlip(880, 0.06)
  showToast(`${m.senderAlias}: ${String(text).slice(0, 36)}`, '💬')

  if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification('PriChat', { body: `${m.senderAlias}: ${text}` }) } catch (e) { /* ignore */ }
  }
}

/* ---------------------- misc wiring ---------------------- */

document.querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    el.chatInput.value += btn.innerText
    el.chatInput.focus()
  })
})

el.btnSendMsg.addEventListener('click', sendMessage)
el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

el.chatInput.addEventListener('input', () => {
  if (!state.passkey) return
  set(ref(db, `${roomPath()}/typing/${state.userId}`), true).catch(() => {})
  clearTimeout(state.typingTimeout)
  state.typingTimeout = setTimeout(() => {
    remove(ref(db, `${roomPath()}/typing/${state.userId}`)).catch(() => {})
  }, 2000)
})