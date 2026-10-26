/* ════════════════════════════════════════════════════════════════
   PeerDrop – Frontend v2
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const formatSize = (b) => b < 1024 ? b+' B' : b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB';
  const escapeHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // ─── Theme Toggle ────────────────────────────────────────────
  (function initTheme() {
    const root = document.documentElement;
    const saved = localStorage.getItem('peerdrop-theme');
    if (saved) {
      root.setAttribute('data-theme', saved);
    }
    // If no saved preference, the CSS handles system default via @media
  })();

  $('#theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme');
    // Determine current effective theme
    let isDark;
    if (current === 'dark') isDark = true;
    else if (current === 'light') isDark = false;
    else isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const next = isDark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('peerdrop-theme', next);
  });

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
  const configReady = fetch('./config').then(r=>r.json()).then(c=>{ config=c; }).catch(()=>{}).then(populateExpiry);

  function populateExpiry() {
    const sel = $('#expiry-select');
    if (!sel) return;
    sel.innerHTML = '';
    config.allowed_expiry_days.forEach(d => {
      const o = document.createElement('option');
      o.value = d; o.textContent = `${d} day${d>1?'s':''}`;
      if (d === config.default_expiry_days) o.selected = true;
      sel.appendChild(o);
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
    new QRCode(element, { text, width:size, height:size, colorDark:'#1a1a2e', colorLight:'#ffffff', correctLevel:QRCode.CorrectLevel.M });
  }

  function shareOrCopy(url, title) {
    if (navigator.share) {
      navigator.share({ title: title||'PeerDrop', url }).catch(()=>{});
    } else {
      navigator.clipboard.writeText(url).then(()=>toast('Link copied!','success')).catch(()=>toast('Copy failed','error'));
    }
  }

  // ─── Mode Toggle ──────────────────────────────────────────────
  const modeToggle = $('#mode-toggle');
  $$('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      $$('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      modeToggle.classList.toggle('beam', mode==='beam');
      $$('.panel').forEach(p => p.classList.remove('active'));
      $(`#panel-${mode}`).classList.add('active');
    });
  });

  // ─── Type Sub-Toggle ──────────────────────────────────────────
  $$('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isFile = btn.dataset.type === 'file';
      $('#input-text').classList.toggle('hidden', isFile);
      $('#input-file').classList.toggle('hidden', !isFile);
    });
  });

  // ─── Drop: Create & Share ─────────────────────────────────────
  let selectedFile = null;
  let currentType = 'text';

  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  ['dragenter','dragover'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', e => { if(e.dataTransfer.files.length) pickFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if(fileInput.files.length) pickFile(fileInput.files[0]); });

  function pickFile(f) {
    if (f.size > config.max_file_size) { toast(`Too large. Max ${formatSize(config.max_file_size)}`,'error'); return; }
    selectedFile = f;
    $('#file-name').textContent = f.name;
    $('#file-size').textContent = formatSize(f.size);
    $('#file-preview').classList.remove('hidden');
  }

  $('#file-remove').addEventListener('click', () => {
    selectedFile = null; fileInput.value = '';
    $('#file-preview').classList.add('hidden');
  });

  $('#create-btn').addEventListener('click', async () => {
    currentType = $('.type-btn.active').dataset.type;
    if (currentType === 'text') await createPaste();
    else await uploadFile();
  });

  async function createPaste() {
    const content = $('#paste-content').value.trim();
    if (!content) { toast('Enter some content','error'); return; }
    const btn = $('#create-btn'); btn.disabled = true;
    const body = { content, expiry_days: parseInt($('#expiry-select').value,10) };
    const pw = $('#password-input').value.trim();
    if (pw) body.password = pw;
    try {
      const res = await fetch('./paste', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error||'Failed');
      const data = await res.json();
      showShareResult(data.id, 'paste', data);
      $('#paste-content').value = '';
    } catch(e) { toast(e.message,'error'); }
    finally { btn.disabled = false; }
  }

  async function uploadFile() {
    if (!selectedFile) { toast('Select a file','error'); return; }
    const btn = $('#create-btn'); btn.disabled = true;
    const fd = new FormData();
    fd.append('file', selectedFile);
    fd.append('expiry_days', $('#expiry-select').value);
    const pw = $('#password-input').value.trim();
    if (pw) fd.append('password', pw);
    const pb = $('#progress-bar'); const pf = $('#progress-fill');
    pb.classList.remove('hidden'); pf.style.width = '0%';
    try {
      const data = await new Promise((resolve,reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => { if(e.lengthComputable) pf.style.width = Math.round(e.loaded/e.total*100)+'%'; });
        xhr.addEventListener('load', () => { xhr.status<300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(JSON.parse(xhr.responseText).error||'Upload failed')); });
        xhr.addEventListener('error', () => reject(new Error('Network error')));
        xhr.open('POST','./upload'); xhr.send(fd);
      });
      showShareResult(data.id, 'file', data);
      selectedFile = null; fileInput.value = '';
      $('#file-preview').classList.add('hidden');
    } catch(e) { toast(e.message,'error'); }
    finally { btn.disabled = false; setTimeout(()=>pb.classList.add('hidden'),800); }
  }

  function showShareResult(id, type, data) {
    const bp = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
    const url = `${location.origin}${bp}view/${type}/${id}`;
    $('#share-link').value = url;
    const meta = type==='paste'
      ? `Expires in ${data.expires_in_days}d · ${data.has_password?'🔒 Protected':'🔓 Public'}`
      : `${data.original_name} · ${formatSize(data.size)} · ${data.expires_in_days}d · ${data.has_password?'🔒':'🔓'}`;
    $('#share-meta').textContent = meta;
    makeQR($('#share-qr'), url, 100);
    $('#share-result').classList.remove('hidden');
    toast(type==='paste'?'Paste created!':'File uploaded!','success');
  }

  $('#copy-link').addEventListener('click', () => {
    navigator.clipboard.writeText($('#share-link').value).then(()=>toast('Copied!','success'));
  });
  $('#share-btn').addEventListener('click', () => shareOrCopy($('#share-link').value));

  // ─── Drop: Retrieve ───────────────────────────────────────────
  $('#retrieve-btn').addEventListener('click', async () => {
    const id = $('#retrieve-id').value.trim();
    if (!id) return;
    const pw = $('#retrieve-pw').value.trim();
    const pwQ = pw ? `?password=${encodeURIComponent(pw)}` : '';
    // Try paste first
    try {
      let res = await fetch(`./paste/${id}${pwQ}`);
      if (res.ok) {
        const d = await res.json();
        $('#retrieve-content').textContent = d.content;
        $('#retrieve-result').classList.remove('hidden');
        toast('Paste retrieved!','success');
        return;
      }
      // Try file
      res = await fetch(`./file/${id}${pwQ}`);
      if (!res.ok) throw new Error((await res.json()).error||'Not found');
      const disp = res.headers.get('Content-Disposition')||'';
      const m = disp.match(/filename="(.+)"/);
      const fname = m?m[1]:'download';
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname; a.click();
      URL.revokeObjectURL(a.href);
      toast('Download started!','success');
    } catch(e) { toast(e.message,'error'); }
  });

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

  let ws = null, room = null, inRoom = false;
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

  $$('#beam-active [data-beam-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const isText = btn.dataset.beamType === 'text';
      $$('#beam-active [data-beam-type]').forEach(b => b.classList.toggle('active', b === btn));
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
    connectWS(Math.random().toString(36).slice(2,8).toUpperCase());
  });

  // Manual join with code
  $('#join-room').addEventListener('click', () => {
    const code = $('#room-input').value.trim();
    if (!code) { toast('Enter a room code','error'); return; }
    connectWS(code);
  });

  $('#leave-room').addEventListener('click', () => leaveRoom());

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
    holdLock();
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
      if (!inRoom) { toast('Could not reach the server','error'); leaveRoom(true); return; }
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
    setRoomCardCollapsible(false);
    $('#beam-connect').classList.remove('hidden');
    $('#beam-room').classList.add('hidden');
    $('#beam-active').classList.add('hidden');
    $('#beam-waiting').classList.remove('hidden');
    $('#beam-history').innerHTML = '';
    if(!silent) toast('Left room','info');
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
    const el = $('#beam-status');
    el.textContent = state === 'online' ? 'Connected' : 'Reconnecting…';
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
        if (wasOpen || msg.reason === 'leave') toast(msg.reason === 'leave' ? 'Peer left' : 'Peer disconnected','info');
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
      if (wasOpen) toast('Connection dropped, reconnecting…','info');
      setTimeout(() => { if (room && roomPeers.has(rid)) ensureLink(rid); }, 1000);
    } else if (wasOpen) {
      toast('Peer disconnected','info');
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
      toast(seenPeers.has(rid) ? 'Peer reconnected' : 'Peer connected!','success');
      seenPeers.add(rid);
      refreshPeers();
    };
    dc.onclose = () => { if (links[rid] === link) linkLost(rid); };
    dc.onmessage = e => { if (links[rid] === link) onData(rid, e.data); };
  }

  function refreshPeers() {
    const n = Object.keys(links).filter(isUp).length;
    const wasEmpty = $('#beam-active').classList.contains('hidden');
    $('#peer-count').textContent = `${n} peer${n===1?'':'s'}`;
    // Keep the history on screen during a reconnect
    const showActive = n > 0 || $('#beam-history').children.length > 0;
    $('#beam-active').classList.toggle('hidden', !showActive);
    $('#beam-waiting').classList.toggle('hidden', n > 0);
    $('#beam-waiting-text').textContent = seenPeers.size ? 'Reconnecting to peer…' : 'Waiting for peer...';
    setRoomCardCollapsible(n > 0);
    if (n > 0 && wasEmpty) setRoomCardCollapsed(true);
  }

  function onData(rid, data) {
    if (typeof data !== 'string') {
      const f = incoming[rid];
      if (!f) return;
      f.chunks.push(data); f.received += data.byteLength;
      updateBeamFile(f.id, f.received, f.size, false);
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
      toast(`Received: ${f.name}`,'success');
    } else if (m.type === 'text') {
      addBeamText(String(m.id), String(m.content), '↓');
      toast('Message received!','success');
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
    if (status) status.textContent = 'Interrupted, send it again';
  }

  const openChannels = () => Object.keys(links).filter(isUp).map(rid => links[rid].dc);

  // ─── P2P text send ──────────────────────────────────────────
  $('#beam-send-text').addEventListener('click', () => sendBeamText());

  function sendBeamText() {
    const text = $('#beam-text').value.trim();
    if (!text) return;
    const chs = openChannels();
    if (!chs.length) { toast('No peers connected', 'error'); return; }
    const mid = randId();
    chs.forEach(dc => dc.send(JSON.stringify({ type: 'text', id: mid, content: text })));
    addBeamText(mid, text, '↑');
    $('#beam-text').value = '';
    toast('Message sent!', 'success');
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
    if (!openChannels().length) { toast('No peers connected','error'); return; }
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
      catch { markFailed(fid); }
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
    }
    chs.forEach(dc => dc.send(JSON.stringify({ type:'file-end', id:fid })));
    updateBeamFile(fid, file.size, file.size, true);
    toast(`Sent: ${file.name}`,'success');
  }

  // ─── Beam history (text + file items) ─────────────────────
  function addBeamText(id, content, dir) {
    const el = document.createElement('div');
    el.className = 'beam-item beam-text-item ' + (dir === '↑' ? 'sent' : 'received');
    el.id = `beam-${id}`;
    el.innerHTML = `<div class="beam-item-header"><span class="beam-dir">${dir === '↑' ? '↑ Sent' : '↓ Received'}</span><span class="beam-time">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div><div class="beam-text-content">${escapeHtml(content)}</div><div class="beam-item-actions"><button class="beam-action-btn" title="Copy text"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button></div>`;
    el.querySelector('.beam-action-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(content).then(() => toast('Copied!', 'success'));
    });
    $('#beam-history').prepend(el);
  }

  function addBeamFile(id, name, size, dir) {
    const el = document.createElement('div');
    el.className = 'beam-item beam-file-item ' + (dir === '↑' ? 'sent' : 'received');
    el.id = `beam-${id}`;
    el.innerHTML = `<div class="beam-item-header"><span class="beam-dir">${dir === '↑' ? '↑ Sent' : '↓ Received'}</span><span class="beam-time">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div><div class="beam-file-info"><span class="beam-file-name">📄 ${escapeHtml(name)}</span><span class="beam-file-size">${formatSize(size)}</span></div><div class="beam-file-progress"><div class="beam-file-progress-fill" style="width:0%"></div></div><span class="beam-file-status">0%</span>`;
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'beam-item-actions hidden';
    if (dir === '↓') {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'beam-action-btn';
      dlBtn.title = 'Download';
      dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download';
      dlBtn.addEventListener('click', () => {
        const rb = receivedBlobs[id];
        if (!rb) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(rb.blob); a.download = rb.name; a.click();
        URL.revokeObjectURL(a.href);
      });
      actionsDiv.appendChild(dlBtn);
    }
    el.appendChild(actionsDiv);
    $('#beam-history').prepend(el);
  }

  function updateBeamFile(id, loaded, total, done) {
    const el = document.getElementById(`beam-${id}`); if (!el) return;
    const pct = total ? Math.round(loaded / total * 100) : 100;
    const fill = el.querySelector('.beam-file-progress-fill');
    const status = el.querySelector('.beam-file-status');
    if (fill) fill.style.width = pct + '%';
    if (status) status.textContent = done ? '✓ Complete' : pct + '%';
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
    navigator.clipboard.writeText(room).then(() => toast('Code copied!', 'success'));
  });

  // Copy invite link
  $('#copy-invite').addEventListener('click', () => {
    const room = $('#room-code-display').textContent;
    shareOrCopy(getInviteUrl(room), 'Join my PeerDrop room');
  });
})();
