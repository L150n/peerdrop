/* ════════════════════════════════════════════════════════════════
   PeerDrop – Frontend
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const formatSize = (b) => b < 1024 ? b+'\u00a0B' : b < 1048576 ? (b/1024).toFixed(1)+'\u00a0KB' : (b/1048576).toFixed(1)+'\u00a0MB';
  const escapeHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const days = (d) => `${d} day${d==1?'':'s'}`;

  // Solar icons (Iconify), used in history items
  const ICON = {
    copy: '<svg class="icon" aria-hidden="true" width="1em" height="1em" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M6 11C6 8.17157 6 6.75736 6.87868 5.87868C7.75736 5 9.17157 5 12 5H15C17.8284 5 19.2426 5 20.1213 5.87868C21 6.75736 21 8.17157 21 11V16C21 18.8284 21 20.2426 20.1213 21.1213C19.2426 22 17.8284 22 15 22H12C9.17157 22 7.75736 22 6.87868 21.1213C6 20.2426 6 18.8284 6 16V11Z"/><path d="M6 19C4.34315 19 3 17.6569 3 16V10C3 6.22876 3 4.34315 4.17157 3.17157C5.34315 2 7.22876 2 11 2H15C16.6569 2 18 3.34315 18 5"/></g></svg>',
    download: '<svg class="icon" aria-hidden="true" width="1em" height="1em" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M3 15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15"/><path d="M12 3V16M8 11.625L12 16L16 11.625"/></g></svg>',
  };

  // ─── Theme Toggle ────────────────────────────────────────────
  // The saved theme is applied by an inline script in <head> before first paint
  $('#theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme');
    const isDark = current ? current === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = isDark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('peerdrop-theme', next);
    syncThemeColor();
  });

  // The browser bar takes the page colour, including a manually chosen theme
  function syncThemeColor() {
    const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    $$('meta[name="theme-color"]').forEach(m => { m.content = paper; });
  }
  if (document.documentElement.hasAttribute('data-theme')) syncThemeColor();

  let config = {
    allowed_expiry_days:[2,4,7],
    default_expiry_days:2,
    max_file_size:31457280,
    ice_servers:[
      { urls:'stun:stun.l.google.com:19302' },
      { urls:'stun:stun1.l.google.com:19302' },
    ],
  };

  // Beam waits for this so peers get the TURN servers from the start
  const configReady = fetch('./config').then(r=>r.json()).then(c=>{ config=c; }).catch(()=>{}).then(applyConfig);

  function applyConfig() {
    const sel = $('#expiry-select');
    sel.innerHTML = '';
    config.allowed_expiry_days.forEach(d => {
      const o = document.createElement('option');
      o.value = d; o.textContent = days(d);
      if (d === config.default_expiry_days) o.selected = true;
      sel.appendChild(o);
    });
    const max = formatSize(config.max_file_size).replace('.0\u00a0', '\u00a0');
    $('#drop-limit').textContent = `Up to ${max}`;
    $$('.max-size').forEach(el => { el.textContent = max; });
    const list = config.allowed_expiry_days;
    $$('.expiry-list').forEach(el => {
      el.textContent = list.length > 1 ? `${list.slice(0,-1).join(', ')} or ${days(list[list.length-1])}` : days(list[0]);
    });
  }

  function toast(msg, type='info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(() => { el.classList.add('removing'); setTimeout(()=>el.remove(),200); }, 3000);
  }

  function makeQR(element, text, size=100) {
    element.innerHTML = '';
    if (typeof QRCode === 'undefined') return;
    new QRCode(element, { text, width:size, height:size, colorDark:'#0e2a33', colorLight:'#ffffff', correctLevel:QRCode.CorrectLevel.M });
  }

  function copyText(text, done='Copied') {
    navigator.clipboard.writeText(text).then(()=>toast(done,'success')).catch(()=>toast('Couldn\'t copy. Select the text and copy it yourself.','error'));
  }

  function shareOrCopy(url, title) {
    if (navigator.share) navigator.share({ title: title||'PeerDrop', url }).catch(()=>{});
    else copyText(url, 'Link copied');
  }

  // ─── The link: status line between you and the other end ────
  // Each mode keeps its own state; the line shows the current mode's.
  let mode = 'drop';
  const linkState = {
    drop: { state:'idle', a:'This device', b:'Anyone with the link', p:0 },
    beam: { state:'idle', a:'You', b:'The other device', p:0 },
  };
  let lastAnnounced = '';

  function setLink(m, next) {
    Object.assign(linkState[m], next);
    if (m === mode) renderLink();
  }

  function renderLink() {
    const s = linkState[mode], el = $('#link');
    el.dataset.state = s.state;
    el.style.setProperty('--p', String(s.p || 0));
    $('#link-label-a').textContent = s.a;
    $('#link-label-b').textContent = s.b;
    // Announce state changes, not every progress tick
    const said = s.state === 'busy' ? 'busy' : s.b;
    if (said !== lastAnnounced) { lastAnnounced = said; $('#link-status').textContent = s.state === 'busy' ? s.b.replace(/ \d+%$/, '') : s.b; }
    document.dispatchEvent(new CustomEvent('pd:link', { detail: { mode, ...s } }));
  }

  // ─── Mode Toggle ──────────────────────────────────────────────
  function setMode(next) {
    mode = next;
    document.documentElement.dataset.mode = next;
    $$('.mode-tab').forEach(b => {
      const on = b.dataset.mode === next;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $$('.panel').forEach(p => {
      const on = p.id === `panel-${next}`;
      p.classList.toggle('active', on);
      p.hidden = !on;
    });
    renderLink();
    // Keep the mode in the URL so reloads and shared links open the same tab
    const q = new URLSearchParams(location.search);
    if (next === 'beam') q.set('mode', 'beam'); else q.delete('mode');
    const qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    document.dispatchEvent(new CustomEvent('pd:mode', { detail: { mode: next } }));
  }

  $$('.mode-tab').forEach(btn => btn.addEventListener('click', () => { if (btn.dataset.mode !== mode) setMode(btn.dataset.mode); }));
  if (new URLSearchParams(location.search).get('mode') === 'beam') setMode('beam');

  // Arrow keys move between the two tabs
  $('#mode-toggle').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = mode === 'drop' ? 'beam' : 'drop';
    setMode(next);
    $(`#toggle-${next}`).focus();
  });

  // ─── Text / file switches ─────────────────────────────────────
  function pickSegment(buttons, btn) {
    buttons.forEach(b => { const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  }

  const dropTypeBtns = $$('#panel-drop .type-btn');
  dropTypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pickSegment(dropTypeBtns, btn);
      const isFile = btn.dataset.type === 'file';
      $('#input-text').classList.toggle('hidden', isFile);
      $('#input-file').classList.toggle('hidden', !isFile);
    });
  });

  // ─── Drop: Create & Share ─────────────────────────────────────
  let selectedFile = null;

  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  ['dragenter','dragover'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', e => { if(e.dataTransfer.files.length) pickFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if(fileInput.files.length) pickFile(fileInput.files[0]); });

  function pickFile(f) {
    if (f.size > config.max_file_size) { toast(`That file is ${formatSize(f.size)}. Drop takes up to ${formatSize(config.max_file_size)}; use Beam for bigger files.`,'error'); return; }
    selectedFile = f;
    $('#file-name').textContent = f.name;
    $('#file-size').textContent = formatSize(f.size);
    $('#file-preview').classList.remove('hidden');
    dropZone.classList.add('hidden');
  }

  $('#file-remove').addEventListener('click', () => {
    selectedFile = null; fileInput.value = '';
    $('#file-preview').classList.add('hidden');
    dropZone.classList.remove('hidden');
    dropZone.focus();
  });

  $('#create-btn').addEventListener('click', async () => {
    const type = $('#panel-drop .type-btn.active').dataset.type;
    if (type === 'text') await createPaste();
    else await uploadFile();
  });

  function busy(btn, on) {
    btn.disabled = on;
    btn.setAttribute('aria-busy', String(on));
  }

  async function createPaste() {
    const content = $('#paste-content').value.trim();
    if (!content) { toast('Type or paste something first','error'); $('#paste-content').focus(); return; }
    const btn = $('#create-btn'); busy(btn, true);
    const body = { content, expiry_days: parseInt($('#expiry-select').value,10) };
    const pw = $('#password-input').value.trim();
    if (pw) body.password = pw;
    setLink('drop', { state:'busy', p:.5, b:'Saving' });
    try {
      const res = await fetch('./paste', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error||'Couldn\'t save that. Try again.');
      const data = await res.json();
      showShareResult(data.id, 'paste', data);
      $('#paste-content').value = '';
    } catch(e) { toast(e.message,'error'); setLink('drop', { state:'idle', p:0, b:'Anyone with the link' }); }
    finally { busy(btn, false); }
  }

  async function uploadFile() {
    if (!selectedFile) { toast('Choose a file first','error'); dropZone.focus(); return; }
    const btn = $('#create-btn'); busy(btn, true);
    const fd = new FormData();
    fd.append('expiry_days', $('#expiry-select').value);
    const pw = $('#password-input').value.trim();
    if (pw) fd.append('password', pw);
    fd.append('file', selectedFile);
    const pf = $('#progress-fill');
    pf.style.width = '0%';
    setLink('drop', { state:'busy', p:0, b:'Uploading 0%' });
    try {
      const data = await new Promise((resolve,reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => {
          if (!e.lengthComputable) return;
          const p = e.loaded / e.total;
          pf.style.width = Math.round(p*100)+'%';
          setLink('drop', { p, b:`Uploading ${Math.round(p*100)}%` });
        });
        const fail = (fallback) => { let m; try { m = JSON.parse(xhr.responseText).error; } catch {} reject(new Error(m || fallback)); };
        xhr.addEventListener('load', () => { xhr.status<300 ? resolve(JSON.parse(xhr.responseText)) : fail('Upload failed. Try again.'); });
        xhr.addEventListener('error', () => reject(new Error('Upload failed. Check your connection and try again.')));
        xhr.open('POST','./upload'); xhr.send(fd);
      });
      showShareResult(data.id, 'file', data);
      selectedFile = null; fileInput.value = '';
      $('#file-preview').classList.add('hidden');
      dropZone.classList.remove('hidden');
    } catch(e) { toast(e.message,'error'); setLink('drop', { state:'idle', p:0, b:'Anyone with the link' }); }
    finally { busy(btn, false); }
  }

  function showShareResult(id, type, data) {
    const bp = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
    const url = `${location.origin}${bp}view/${type}/${id}`;
    $('#share-link').value = url;
    const lock = data.has_password ? 'Needs the password.' : 'No password.';
    const meta = type==='paste'
      ? `Deleted in ${days(data.expires_in_days)}. ${lock}`
      : `${data.original_name}, ${formatSize(data.size)}. Deleted in ${days(data.expires_in_days)}. ${lock}`;
    $('#share-meta').textContent = meta;
    makeQR($('#share-qr'), url, 100);
    $('#share-empty').classList.add('hidden');
    $('#share-result').classList.remove('hidden');
    setLink('drop', { state:'linked', p:1, b:'Link ready' });
    toast('Link created','success');
  }

  $('#copy-link').addEventListener('click', () => copyText($('#share-link').value, 'Link copied'));
  $('#share-btn').addEventListener('click', () => shareOrCopy($('#share-link').value));

  // ─── Drop: Retrieve ───────────────────────────────────────────
  $('#retrieve-btn').addEventListener('click', async () => {
    const id = $('#retrieve-id').value.trim();
    if (!id) { toast('Enter the code you were given','error'); $('#retrieve-id').focus(); return; }
    const pw = $('#retrieve-pw').value.trim();
    const pwQ = pw ? `?password=${encodeURIComponent(pw)}` : '';
    const key = encodeURIComponent(id);
    try {
      let res = await fetch(`./paste/${key}${pwQ}`);
      if (res.ok) {
        const d = await res.json();
        $('#retrieve-content').textContent = d.content;
        $('#retrieve-result').classList.remove('hidden');
        return;
      }
      res = await fetch(`./file/${key}${pwQ}`);
      if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error||'Nothing found for that code. It may have expired.');
      const disp = res.headers.get('Content-Disposition')||'';
      const m = disp.match(/filename="(.+)"/);
      const fname = m?m[1]:'download';
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Download started','success');
    } catch(e) { toast(e.message,'error'); }
  });
  ['#retrieve-id','#retrieve-pw'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') $('#retrieve-btn').click(); }));

  // ─── Beam: P2P WebRTC ─────────────────────────────────────────
  // The signaling socket is only needed while peers find each other. Once a data
  // channel is open it runs on its own, so losing the socket (proxy timeout, phone
  // asleep, tab in the background) must not end the session: we reconnect quietly
  // with the same peer id and only rebuild links that actually died.
  const CHUNK = 16384;
  const BUFFER_HIGH = 1 << 20;  // pause sending when 1 MB is queued...
  const BUFFER_LOW = 1 << 18;   // ...and resume below 256 KB
  const randId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const myPeerId = randId();

  let ws = null, room = null, inRoom = false, signalOk = false;
  let transfer = null;        // { up, p } while a file is moving
  let wsRetry = 0, wsTimer = null, lastHeard = 0;
  let links = {};             // remote peerId -> { pc, dc, sid, born, opened, timers }
  let roomPeers = new Set();  // who the server says is in the room
  let seenPeers = new Set();  // peers we've had a link with, for "reconnected" toasts
  let incoming = {};          // remote peerId -> file being received from them
  let receivedBlobs = {};
  let sigQueue = Promise.resolve();
  let releaseLock = null;
  const sendQueue = []; let sending = false;

  const roomCodeCard = $('#room-code-card');
  const roomCodeToggle = $('#room-code-toggle');
  const roomCodeToggleText = $('#room-code-toggle-text');

  function setRoomCardCollapsed(collapsed) {
    roomCodeCard.classList.toggle('collapsed', collapsed);
    roomCodeToggle.setAttribute('aria-expanded', String(!collapsed));
    roomCodeToggleText.textContent = collapsed ? 'Show invite' : 'Hide invite';
  }

  function setRoomCardCollapsible(collapsible) {
    roomCodeCard.classList.toggle('collapsible', collapsible);
    roomCodeToggle.disabled = !collapsible;
    if (!collapsible) setRoomCardCollapsed(false);
  }

  roomCodeToggle.addEventListener('click', () => {
    if (!roomCodeCard.classList.contains('collapsible')) return;
    setRoomCardCollapsed(!roomCodeCard.classList.contains('collapsed'));
  });

  const beamTypeBtns = $$('#beam-active [data-beam-type]');
  beamTypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const isText = btn.dataset.beamType === 'text';
      pickSegment(beamTypeBtns, btn);
      $('#beam-send-panel-text').classList.toggle('hidden', !isText);
      $('#beam-send-panel-file').classList.toggle('hidden', isText);
    });
  });

  // Check URL params for auto-join
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.has('room')) {
    $('#toggle-beam').click();
    connectWS(urlParams.get('room'));
  }

  // Create Invite: auto-generate room code and join
  $('#create-invite').addEventListener('click', () => {
    // No 0/O, 1/I/L: people often type these codes from another screen
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    connectWS(Array.from(crypto.getRandomValues(new Uint8Array(6)), n => abc[n % abc.length]).join(''));
  });

  // Manual join with code
  $('#join-form').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('#room-input').value.trim();
    if (!code) { toast('Enter the room code you were given','error'); $('#room-input').focus(); return; }
    connectWS(code);
  });

  const unsavedFiles = () => Object.values(receivedBlobs).filter(b => !b.saved).length;

  $('#leave-room').addEventListener('click', () => {
    const n = unsavedFiles();
    if (n && !confirm(`Leave the room? ${n === 1 ? 'A file you received hasn\'t' : `${n} files you received haven't`} been saved yet and will be lost.`)) return;
    leaveRoom();
  });

  window.addEventListener('beforeunload', e => { if (room && unsavedFiles()) e.preventDefault(); });

  // Come back quickly after the phone slept or the tab was frozen
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSocket(); });
  document.addEventListener('resume', checkSocket);
  window.addEventListener('online', checkSocket);
  window.addEventListener('pageshow', e => { if (e.persisted) checkSocket(); });
  window.addEventListener('pagehide', e => {
    if (!e.persisted && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'leave' }));
  });

  function connectWS(code) {
    if (room) leaveRoom(true);
    room = code.trim().toUpperCase();
    wsRetry = 0;
    signalOk = false;
    holdLock();
    setLink('beam', { state:'waiting', b:'Connecting…' });
    configReady.then(() => { if (room && !ws) openSocket(); });
  }

  function openSocket() {
    clearTimeout(wsTimer);
    const proto = location.protocol==='https:'?'wss:':'ws:';
    const bp = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
    const s = new WebSocket(`${proto}//${location.host}${bp}ws`);
    ws = s;
    s.onopen = () => {
      wsRetry = 0; lastHeard = Date.now();
      s.send(JSON.stringify({ type:'join', room, peerId:myPeerId }));
    };
    s.onmessage = e => {
      if (ws !== s) return;
      lastHeard = Date.now();
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      sigQueue = sigQueue.then(() => handleSig(msg)).catch(err => console.warn('PeerDrop signaling:', err));
    };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      if (!room) return;
      if (!inRoom) { toast('Couldn\'t reach the server. Check your connection and try again.','error'); leaveRoom(true); return; }
      setSignal('reconnecting');
      wsTimer = setTimeout(openSocket, Math.min(1000 * 2 ** wsRetry++, 15000));
    };
  }

  // After the phone sleeps a socket can still look open although the connection
  // is gone. Ping it, and replace it if the server doesn't answer in time.
  function checkSocket() {
    if (!room) return;
    if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      wsRetry = 0; openSocket(); return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    const s = ws, sentAt = Date.now();
    s.send(JSON.stringify({ type:'ping' }));
    setTimeout(() => {
      if (ws !== s || lastHeard >= sentAt) return;
      ws = null; s.onclose = null; s.close();
      setSignal('reconnecting');
      wsRetry = 0; openSocket();
    }, 4000);
  }

  function signal(type, target, data) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, target, data }));
  }

  function leaveRoom(silent) {
    const s = ws;
    ws = null; room = null; inRoom = false;
    clearTimeout(wsTimer);
    if (s) {
      s.onclose = null;
      if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type:'leave' }));
      s.close();
    }
    Object.keys(links).forEach(dropLink);
    roomPeers.clear(); seenPeers.clear();
    incoming = {}; receivedBlobs = {}; sendQueue.length = 0;
    dropLock();
    document.documentElement.classList.remove('in-room');
    setRoomCardCollapsible(false);
    $('#beam-connect').classList.remove('hidden');
    $('#beam-room').classList.add('hidden');
    $('#beam-active').classList.add('hidden');
    $('#beam-waiting').classList.remove('hidden');
    $('#beam-history').innerHTML = '';
    transfer = null;
    beamLink();
    const q = new URLSearchParams(location.search);
    if (q.has('room')) { q.delete('room'); const qs = q.toString(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); }
    if(!silent) toast('Left the room','info');
  }

  // Chrome doesn't freeze a background tab that holds a Web Lock
  function holdLock() {
    if (!navigator.locks || releaseLock) return;
    navigator.locks.request(`peerdrop-beam-${myPeerId}`, () => new Promise(r => { releaseLock = r; })).catch(()=>{});
  }
  function dropLock() { if (releaseLock) { releaseLock(); releaseLock = null; } }

  function getInviteUrl(code) {
    const bp = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
    return `${location.origin}${bp}?room=${encodeURIComponent(code)}`;
  }

  function setSignal(state) {
    signalOk = state === 'online';
    beamLink();
    const el = $('#beam-status');
    el.textContent = state === 'online' ? 'In the room' : 'Reconnecting to the server…';
    el.classList.toggle('badge-success', state === 'online');
    el.classList.toggle('badge-warning', state !== 'online');
  }

  async function handleSig(msg) {
    switch(msg.type) {
      case 'joined': {
        const first = !inRoom;
        inRoom = true;
        setSignal('online');
        roomPeers = new Set(msg.peers);
        if (first) {
          document.documentElement.classList.add('in-room');
          $('#beam-connect').classList.add('hidden');
          $('#beam-room').classList.remove('hidden');
          $('#room-code-display').textContent = msg.room;
          makeQR($('#invite-qr'), getInviteUrl(msg.room), 100);
        }
        // Links to peers who left while our socket was down
        Object.keys(links).forEach(rid => { if (!roomPeers.has(rid) && !isUp(rid)) dropLink(rid); });
        // Anything negotiated while our socket was down may have lost messages
        msg.peers.forEach(rid => ensureLink(rid, true));
        refreshPeers();
        break;
      }
      case 'peer-joined':
        roomPeers.add(msg.peerId);
        ensureLink(msg.peerId, true);
        break;
      case 'peer-left': {
        const rid = msg.peerId;
        roomPeers.delete(rid);
        // Only its signaling dropped: keep a working link, it will rejoin
        if (msg.reason !== 'leave' && isUp(rid)) break;
        const wasOpen = links[rid] && links[rid].opened;
        dropLink(rid);
        failIncoming(rid);
        refreshPeers();
        if (wasOpen || msg.reason === 'leave') toast(msg.reason === 'leave' ? 'The other device left the room' : 'The other device disconnected','info');
        break;
      }
      case 'offer': {
        const { sid, sdp } = msg.data || {};
        if (!sid || !sdp) break;
        // The other side makes the offers, so a new one replaces any link we had
        dropLink(msg.from);
        const link = createLink(msg.from, sid, false);
        await link.pc.setRemoteDescription(sdp);
        await link.pc.setLocalDescription(await link.pc.createAnswer());
        signal('answer', msg.from, { sid, sdp:link.pc.localDescription });
        break;
      }
      case 'answer': {
        const link = links[msg.from], d = msg.data || {};
        if (link && link.sid === d.sid && link.pc.signalingState === 'have-local-offer') await link.pc.setRemoteDescription(d.sdp);
        break;
      }
      case 'ice-candidate': {
        const link = links[msg.from], d = msg.data || {};
        if (link && link.sid === d.sid && d.candidate) await link.pc.addIceCandidate(d.candidate).catch(()=>{});
        break;
      }
      case 'reconnect': {
        // The other side lost its link to us and asks us (the offerer) to rebuild it
        const link = links[msg.from];
        if (iOffer(msg.from) && (!link || Date.now() - link.born > 5000)) {
          dropLink(msg.from);
          createLink(msg.from, randId(), true);
        }
        break;
      }
      case 'error':
        toast(msg.message,'error');
        if (!inRoom) leaveRoom(true);
        break;
    }
  }

  // The peer with the smaller id always makes the offer, so two peers never
  // offer to each other at the same time
  const iOffer = rid => myPeerId < rid;
  const isUp = rid => !!(links[rid] && links[rid].dc && links[rid].dc.readyState === 'open');

  // force: the peer has a fresh socket, so an offer in flight may never have arrived
  function ensureLink(rid, force) {
    if (rid === myPeerId || isUp(rid)) return;
    const link = links[rid];
    if (!force && link && Date.now() - link.born < 10000 && !['failed','closed'].includes(link.pc.connectionState)) return;
    if (iOffer(rid)) { dropLink(rid); createLink(rid, randId(), true); }
    else signal('reconnect', rid);
  }

  function createLink(rid, sid, offerer) {
    const pc = new RTCPeerConnection({ iceServers: config.ice_servers || [] });
    const link = { pc, sid, dc:null, born:Date.now(), opened:false, grace:null, timeout:null };
    links[rid] = link;
    const current = () => links[rid] === link;

    pc.onicecandidate = e => { if (e.candidate && current()) signal('ice-candidate', rid, { sid, candidate:e.candidate }); };
    pc.ondatachannel = e => { if (current()) setupDC(e.channel, rid, link); };
    pc.onconnectionstatechange = () => {
      if (!current()) return;
      clearTimeout(link.grace);
      const st = pc.connectionState;
      if (st === 'failed' || st === 'closed') linkLost(rid);
      // 'disconnected' often heals by itself (network blip, phone waking up)
      else if (st === 'disconnected') link.grace = setTimeout(() => {
        if (current() && pc.connectionState !== 'connected') linkLost(rid);
      }, 8000);
    };
    // Give up on a negotiation that never completes (offer lost, peer gone)
    link.timeout = setTimeout(() => { if (current() && !isUp(rid)) linkLost(rid); }, 20000);

    if (offerer) {
      setupDC(pc.createDataChannel('ft'), rid, link);
      pc.createOffer()
        .then(o => pc.setLocalDescription(o))
        .then(() => { if (current()) signal('offer', rid, { sid, sdp:pc.localDescription }); })
        .catch(() => { if (current()) linkLost(rid); });
    }
    return link;
  }

  function dropLink(rid) {
    const link = links[rid];
    if (!link) return;
    delete links[rid];
    clearTimeout(link.grace); clearTimeout(link.timeout);
    try { if (link.dc) link.dc.close(); } catch {}
    link.pc.close();
  }

  // A link died on its own. Rebuild it if the peer is still around.
  function linkLost(rid) {
    const wasOpen = links[rid] && links[rid].opened;
    dropLink(rid);
    failIncoming(rid);
    refreshPeers();
    if (roomPeers.has(rid) || !ws) {
      if (wasOpen) toast('Connection dropped. Reconnecting…','info');
      setTimeout(() => { if (room && roomPeers.has(rid)) ensureLink(rid); }, 1000);
    } else if (wasOpen) {
      toast('The other device disconnected','info');
    }
  }

  function setupDC(dc, rid, link) {
    link.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = BUFFER_LOW;
    dc.onopen = () => {
      if (links[rid] !== link) return;
      link.opened = true;
      clearTimeout(link.timeout);
      toast(seenPeers.has(rid) ? 'Reconnected' : 'Connected to the other device','success');
      seenPeers.add(rid);
      refreshPeers();
    };
    dc.onclose = () => { if (links[rid] === link) linkLost(rid); };
    dc.onmessage = e => { if (links[rid] === link) onData(rid, e.data); };
  }

  function refreshPeers() {
    const n = Object.keys(links).filter(isUp).length;
    const wasEmpty = $('#beam-active').classList.contains('hidden');
    $('#peer-count').textContent = `${n} other device${n===1?'':'s'}`;
    // Keep the history on screen during a reconnect
    const showActive = n > 0 || $('#beam-history').children.length > 0;
    $('#beam-active').classList.toggle('hidden', !showActive);
    $('#beam-waiting').classList.toggle('hidden', n > 0);
    $('#beam-waiting-text').textContent = seenPeers.size
      ? 'Reconnecting to the other device…'
      : 'Waiting for someone to join. Share the code, the link or the QR code.';
    setRoomCardCollapsible(n > 0);
    if (n > 0 && wasEmpty) setRoomCardCollapsed(true);
    beamLink();
  }

  // What the link line says in Beam mode
  function beamLink() {
    const n = Object.keys(links).filter(isUp).length;
    if (!room) return setLink('beam', { state:'idle', p:0, b:'The other device' });
    if (!inRoom) return setLink('beam', { state:'waiting', p:0, b:'Connecting…' });
    if (n === 0 && (seenPeers.size || !signalOk)) return setLink('beam', { state:'reconnecting', p:0, b:'Reconnecting…' });
    if (n === 0) return setLink('beam', { state:'waiting', p:0, b:'Waiting for someone to join' });
    if (transfer) return setLink('beam', { state:'busy', p:transfer.p, b:`${transfer.up ? 'Sending' : 'Receiving'} ${Math.round(transfer.p*100)}%` });
    setLink('beam', { state:'linked', p:1, b: n === 1 ? 'Connected' : `${n} devices connected` });
  }

  function setTransfer(up, loaded, total) {
    transfer = loaded < total ? { up, p: total ? loaded / total : 1 } : null;
    beamLink();
  }

  function onData(rid, data) {
    if (typeof data !== 'string') {
      const f = incoming[rid];
      if (!f) return;
      f.chunks.push(data); f.received += data.byteLength;
      updateBeamFile(f.id, f.received, f.size, false);
      setTransfer(false, f.received, f.size);
      return;
    }
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'file-meta') {
      failIncoming(rid);
      incoming[rid] = { id:String(m.id), name:String(m.name), size:Number(m.size)||0, received:0, chunks:[] };
      addBeamFile(incoming[rid].id, incoming[rid].name, incoming[rid].size, '↓');
    } else if (m.type === 'file-end') {
      const f = incoming[rid];
      if (!f || f.id !== String(m.id)) return;
      delete incoming[rid];
      receivedBlobs[f.id] = { blob:new Blob(f.chunks), name:f.name };
      updateBeamFile(f.id, f.size, f.size, true);
      setTransfer(false, 1, 1);
      toast(`Received ${f.name}`,'success');
    } else if (m.type === 'text') {
      addBeamText(String(m.id), String(m.content), '↓');
      toast('New message','success');
    }
  }

  function failIncoming(rid) {
    const f = incoming[rid];
    if (!f) return;
    delete incoming[rid];
    markFailed(f.id);
  }

  function markFailed(id) {
    const el = document.getElementById(`beam-${id}`);
    if (!el) return;
    el.classList.add('failed');
    const status = el.querySelector('.beam-file-status');
    if (status) status.textContent = 'Interrupted. Send it again once you\'re reconnected.';
  }

  const openChannels = () => Object.keys(links).filter(isUp).map(rid => links[rid].dc);

  // ─── P2P text send ──────────────────────────────────────────
  $('#beam-send-text').addEventListener('click', () => sendBeamText());

  function sendBeamText() {
    const text = $('#beam-text').value.trim();
    if (!text) return;
    const chs = openChannels();
    if (!chs.length) { toast('Nobody is connected yet. Wait for the other device to join.', 'error'); return; }
    const mid = randId();
    chs.forEach(dc => dc.send(JSON.stringify({ type: 'text', id: mid, content: text })));
    addBeamText(mid, text, '↑');
    $('#beam-text').value = '';
    toast('Sent', 'success');
  }

  // ─── P2P file send ─────────────────────────────────────────
  const p2pDrop = $('#p2p-drop-zone');
  const p2pInput = $('#p2p-file-input');
  p2pDrop.addEventListener('click', () => p2pInput.click());
  ['dragenter','dragover'].forEach(e => p2pDrop.addEventListener(e,ev=>{ev.preventDefault();p2pDrop.classList.add('dragover');}));
  ['dragleave','drop'].forEach(e => p2pDrop.addEventListener(e,ev=>{ev.preventDefault();p2pDrop.classList.remove('dragover');}));
  p2pDrop.addEventListener('drop', e => { if(e.dataTransfer.files.length) sendP2P(e.dataTransfer.files[0]); });
  p2pInput.addEventListener('change', () => { if(p2pInput.files.length) sendP2P(p2pInput.files[0]); p2pInput.value=''; });

  // Files go out one at a time, so the receiver knows which file a chunk belongs to
  function sendP2P(file) {
    if (!openChannels().length) { toast('Nobody is connected yet. Wait for the other device to join.','error'); return; }
    const fid = randId();
    addBeamFile(fid, file.name, file.size, '↑');
    sendQueue.push({ fid, file });
    if (!sending) pumpQueue();
  }

  async function pumpQueue() {
    sending = true;
    while (sendQueue.length) {
      const { fid, file } = sendQueue.shift();
      try { await sendFile(fid, file); }
      catch { markFailed(fid); setTransfer(true, 1, 1); }
    }
    sending = false;
  }

  // Wait until the channel's send buffer has room. Sending without waiting
  // overfills it on big files and Chrome errors out or drops the channel.
  const drain = dc => dc.bufferedAmount <= BUFFER_HIGH ? null : new Promise(res => {
    const done = () => { dc.removeEventListener('bufferedamountlow', done); dc.removeEventListener('close', done); res(); };
    dc.addEventListener('bufferedamountlow', done);
    dc.addEventListener('close', done);
  });

  async function sendFile(fid, file) {
    let chs = openChannels();
    if (!chs.length) throw new Error('No peers');
    chs.forEach(dc => dc.send(JSON.stringify({ type:'file-meta', id:fid, name:file.name, size:file.size })));
    for (let off = 0; off < file.size; off += CHUNK) {
      const chunk = await file.slice(off, off + CHUNK).arrayBuffer();
      await Promise.all(chs.map(drain));
      chs = chs.filter(dc => dc.readyState === 'open');
      if (!chs.length) throw new Error('Peers gone');
      chs.forEach(dc => dc.send(chunk));
      updateBeamFile(fid, Math.min(off + CHUNK, file.size), file.size, false);
      setTransfer(true, Math.min(off + CHUNK, file.size), file.size);
    }
    chs.forEach(dc => dc.send(JSON.stringify({ type:'file-end', id:fid })));
    updateBeamFile(fid, file.size, file.size, true);
    setTransfer(true, 1, 1);
    toast(`Sent ${file.name}`,'success');
  }

  // ─── Beam history (text + file items) ─────────────────────
  function beamItem(id, kind, dir) {
    const el = document.createElement('li');
    el.className = `beam-item beam-${kind}-item ${dir === '↑' ? 'sent' : 'received'}`;
    el.id = `beam-${id}`;
    const time = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    el.innerHTML = `<div class="beam-item-header"><span class="beam-dir">${dir === '↑' ? 'You sent' : 'Received'}</span><time class="beam-time">${time}</time></div>`;
    return el;
  }

  function actionButton(icon, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'beam-action-btn';
    btn.innerHTML = `${ICON[icon]}<span>${label}</span>`;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function addBeamText(id, content, dir) {
    const el = beamItem(id, 'text', dir);
    const body = document.createElement('div');
    body.className = 'beam-text-content';
    body.textContent = content;
    const actions = document.createElement('div');
    actions.className = 'beam-item-actions';
    actions.appendChild(actionButton('copy', 'Copy', () => copyText(content)));
    el.append(body, actions);
    $('#beam-history').prepend(el);
  }

  function addBeamFile(id, name, size, dir) {
    const el = beamItem(id, 'file', dir);
    el.insertAdjacentHTML('beforeend', `<div class="beam-file-info"><span class="beam-file-name">${escapeHtml(name)}</span><span class="beam-file-size">${formatSize(size)}</span></div><div class="beam-file-progress"><div class="beam-file-progress-fill" style="width:0%"></div></div><span class="beam-file-status">0%</span>`);
    if (dir === '↓') {
      const actions = document.createElement('div');
      actions.className = 'beam-item-actions hidden';
      actions.appendChild(actionButton('download', 'Save file', () => {
        const rb = receivedBlobs[id];
        if (!rb) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(rb.blob); a.download = rb.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        rb.saved = true;
      }));
      el.appendChild(actions);
    }
    $('#beam-history').prepend(el);
  }

  function updateBeamFile(id, loaded, total, done) {
    const el = document.getElementById(`beam-${id}`); if (!el) return;
    const pct = total ? Math.round(loaded / total * 100) : 100;
    const fill = el.querySelector('.beam-file-progress-fill');
    const status = el.querySelector('.beam-file-status');
    if (fill) fill.style.width = pct + '%';
    if (status) status.textContent = done ? (el.classList.contains('sent') ? 'Sent' : 'Received') : pct + '%';
    if (done) {
      el.classList.add('complete');
      const actions = el.querySelector('.beam-item-actions');
      if (actions) actions.classList.remove('hidden');
      const prog = el.querySelector('.beam-file-progress');
      if (prog) prog.classList.add('hidden');
    }
  }

  // Copy code button
  $('#copy-code-btn').addEventListener('click', () => {
    const room = $('#room-code-display').textContent;
    copyText(room, 'Code copied');
  });

  // Copy invite link
  $('#copy-invite').addEventListener('click', () => {
    const room = $('#room-code-display').textContent;
    shareOrCopy(getInviteUrl(room), 'Join my PeerDrop room');
  });
  renderLink();
})();
