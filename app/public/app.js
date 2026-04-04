/* ════════════════════════════════════════════════════════════════
   PeerDrop – Frontend v2
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const formatSize = (b) => b < 1024 ? b+' B' : b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB';

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

  let config = { allowed_expiry_days:[2,4,7], default_expiry_days:2, max_file_size:31457280 };

  fetch('./config').then(r=>r.json()).then(c=>{ config=c; populateExpiry(); }).catch(()=>populateExpiry());

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
    const url = `${location.origin}${bp}${type}/${id}`;
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
  let ws=null, myPeerId=null, peers={}, dataChannels={}, incomingFiles={};
  const ICE = [{ urls:'stun:stun.l.google.com:19302' },{ urls:'stun:stun1.l.google.com:19302' }];
  const CHUNK = 16384;

  // Check URL params for auto-join
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.has('room')) {
    const room = urlParams.get('room');
    $('#toggle-beam').click();
    setTimeout(() => { connectWS(room); }, 300);
  }

  // Create Invite: auto-generate room code and join
  $('#create-invite').addEventListener('click', () => {
    const room = Math.random().toString(36).slice(2,8).toUpperCase();
    connectWS(room);
  });

  // Manual join with code
  $('#join-room').addEventListener('click', () => {
    const room = $('#room-input').value.trim();
    if (!room) { toast('Enter a room code','error'); return; }
    connectWS(room);
  });

  $('#leave-room').addEventListener('click', () => disconnectWS());

  function connectWS(room) {
    const proto = location.protocol==='https:'?'wss:':'ws:';
    const bp = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
    ws = new WebSocket(`${proto}//${location.host}${bp}ws`);
    ws.onopen = () => ws.send(JSON.stringify({type:'join',room}));
    ws.onmessage = e => handleSig(JSON.parse(e.data));
    ws.onclose = () => disconnectWS(true);
    ws.onerror = () => toast('Connection error','error');
  }

  function disconnectWS(silent) {
    if(ws){ws.close();ws=null;}
    Object.values(peers).forEach(pc=>pc.close());
    peers={}; dataChannels={}; myPeerId=null;
    $('#beam-connect').classList.remove('hidden');
    $('#beam-room').classList.add('hidden');
    $('#beam-active').classList.add('hidden');
    $('#beam-waiting').classList.remove('hidden');
    $('#p2p-transfers').innerHTML = '';
    if(!silent) toast('Left room','info');
  }

  function getInviteUrl(room) {
    const bp = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
    return `${location.origin}${bp}?room=${encodeURIComponent(room)}`;
  }

  async function handleSig(msg) {
    switch(msg.type) {
      case 'joined':
        myPeerId = msg.peerId;
        $('#beam-connect').classList.add('hidden');
        $('#beam-room').classList.remove('hidden');
        $('#room-code-display').textContent = `Room: ${msg.room}`;
        updatePeerCount(msg.peers.length);
        makeQR($('#invite-qr'), getInviteUrl(msg.room), 100);
        for(const rp of msg.peers) await createPC(rp,true);
        break;
      case 'peer-joined':
        await createPC(msg.peerId,false);
        showBeamActive();
        updatePeerCount();
        toast('Peer connected!','success');
        break;
      case 'peer-left':
        if(peers[msg.peerId]){peers[msg.peerId].close();delete peers[msg.peerId];delete dataChannels[msg.peerId];}
        updatePeerCount();
        if(!Object.keys(peers).length){$('#beam-active').classList.add('hidden');$('#beam-waiting').classList.remove('hidden');}
        toast('Peer disconnected','info');
        break;
      case 'offer': {
        const pc=peers[msg.from]||(await createPC(msg.from,false));
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        const ans=await pc.createAnswer(); await pc.setLocalDescription(ans);
        ws.send(JSON.stringify({type:'answer',target:msg.from,data:ans}));
        break;
      }
      case 'answer': { const pc=peers[msg.from]; if(pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.data)); break; }
      case 'ice-candidate': { const pc=peers[msg.from]; if(pc&&msg.data) await pc.addIceCandidate(new RTCIceCandidate(msg.data)); break; }
      case 'error': toast(msg.message,'error'); break;
    }
  }

  async function createPC(remotePeerId,initiator) {
    const pc = new RTCPeerConnection({iceServers:ICE});
    peers[remotePeerId] = pc;
    pc.onicecandidate = e => { if(e.candidate&&ws) ws.send(JSON.stringify({type:'ice-candidate',target:remotePeerId,data:e.candidate})); };
    pc.ondatachannel = e => setupDC(e.channel,remotePeerId);
    if(initiator) {
      const dc=pc.createDataChannel('ft');
      setupDC(dc,remotePeerId);
      const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({type:'offer',target:remotePeerId,data:offer}));
    }
    return pc;
  }

  function setupDC(dc,rpid) {
    dc.binaryType='arraybuffer';
    dataChannels[rpid]=dc;
    dc.onopen = () => { showBeamActive(); updatePeerCount(); };
    dc.onmessage = e => {
      if(typeof e.data==='string') {
        const m=JSON.parse(e.data);
        if(m.type==='file-meta') {
          incomingFiles[m.id]={name:m.name,size:m.size,received:0,chunks:[]};
          addTransfer(m.id,m.name,m.size,'↓');
        } else if(m.type==='file-end') {
          const f=incomingFiles[m.id]; if(!f) return;
          const blob=new Blob(f.chunks); const a=document.createElement('a');
          a.href=URL.createObjectURL(blob); a.download=f.name; a.click(); URL.revokeObjectURL(a.href);
          updateTransfer(m.id,f.size,f.size,true);
          delete incomingFiles[m.id];
          toast(`Received: ${f.name}`,'success');
        }
      } else {
        const aid=Object.keys(incomingFiles).pop();
        if(aid&&incomingFiles[aid]) {
          const f=incomingFiles[aid]; f.chunks.push(e.data); f.received+=e.data.byteLength;
          updateTransfer(aid,f.received,f.size,false);
        }
      }
    };
  }

  function showBeamActive() { $('#beam-waiting').classList.add('hidden'); $('#beam-active').classList.remove('hidden'); }
  function updatePeerCount(c) { $('#peer-count').textContent = `${c!==undefined?c:Object.keys(peers).length} peer(s)`; }

  // P2P file send
  const p2pDrop = $('#p2p-drop-zone');
  const p2pInput = $('#p2p-file-input');
  p2pDrop.addEventListener('click', () => p2pInput.click());
  ['dragenter','dragover'].forEach(e => p2pDrop.addEventListener(e,ev=>{ev.preventDefault();p2pDrop.classList.add('dragover');}));
  ['dragleave','drop'].forEach(e => p2pDrop.addEventListener(e,ev=>{ev.preventDefault();p2pDrop.classList.remove('dragover');}));
  p2pDrop.addEventListener('drop', e => { if(e.dataTransfer.files.length) sendP2P(e.dataTransfer.files[0]); });
  p2pInput.addEventListener('change', () => { if(p2pInput.files.length) sendP2P(p2pInput.files[0]); p2pInput.value=''; });

  function sendP2P(file) {
    const chs=Object.values(dataChannels).filter(dc=>dc.readyState==='open');
    if(!chs.length){toast('No peers connected','error');return;}
    const fid=Math.random().toString(36).slice(2,10);
    chs.forEach(dc=>dc.send(JSON.stringify({type:'file-meta',id:fid,name:file.name,size:file.size})));
    addTransfer(fid,file.name,file.size,'↑');
    const reader=new FileReader(); let off=0;
    reader.onload = e => {
      const chunk=e.target.result;
      chs.forEach(dc=>dc.send(chunk));
      off+=chunk.byteLength;
      updateTransfer(fid,off,file.size,false);
      if(off<file.size) readSlice(off);
      else { chs.forEach(dc=>dc.send(JSON.stringify({type:'file-end',id:fid}))); updateTransfer(fid,file.size,file.size,true); toast(`Sent: ${file.name}`,'success'); }
    };
    function readSlice(o){reader.readAsArrayBuffer(file.slice(o,o+CHUNK));}
    readSlice(0);
  }

  function addTransfer(id,name,size,dir) {
    const el=document.createElement('div'); el.className='transfer-item'; el.id=`tr-${id}`;
    el.innerHTML=`<span class="transfer-name">${dir} ${name}</span><span class="transfer-status">0 / ${formatSize(size)}</span><div class="transfer-progress"><div class="transfer-progress-fill" style="width:0%"></div></div>`;
    $('#p2p-transfers').prepend(el);
  }

  function updateTransfer(id,loaded,total,done) {
    const el=$(`#tr-${id}`); if(!el) return;
    const pct=Math.round(loaded/total*100);
    el.querySelector('.transfer-status').textContent = done?`✓ ${formatSize(total)}`:`${formatSize(loaded)} / ${formatSize(total)}`;
    el.querySelector('.transfer-progress-fill').style.width=pct+'%';
    if(done) el.classList.add('complete');
  }

  // Invite link
  $('#copy-invite').addEventListener('click', () => {
    const room = $('#room-code-display').textContent.replace('Room: ','');
    shareOrCopy(getInviteUrl(room), 'Join my PeerDrop room');
  });
})();
