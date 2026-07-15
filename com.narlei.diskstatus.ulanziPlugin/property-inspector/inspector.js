let settings = {};
let loaded = false;
let volumes = [];
// The last diskId this PI itself sent via setSettings — lets us recognize the
// deck echoing our own save back through didReceiveSettings and skip
// re-populating from it (an echo mid-edit would otherwise clobber the select).
let lastSent = null;

const diskEl = document.getElementById('diskId');
const refreshBtn = document.getElementById('refreshBtn');

function optionLabel(v) {
  // Labels are pre-formatted by the Node side so they match the button exactly
  // regardless of the OS byte-base convention.
  const free = v.freeLabel || `${v.free} B`;
  const total = v.totalLabel || `${v.total} B`;
  return `${v.label} — ${free} free of ${total}`;
}

function renderOptions() {
  const current = settings.diskId || '';
  diskEl.innerHTML = '';

  if (!volumes.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No disks found';
    diskEl.appendChild(opt);
    return;
  }

  // If the saved selection isn't among the detected volumes (e.g. an
  // external drive that's currently unplugged), keep it visible but disabled
  // so the button doesn't silently switch to something else underneath it.
  const known = volumes.some((v) => v.id === current);
  if (current && !known) {
    const opt = document.createElement('option');
    opt.value = current;
    opt.textContent = `${settings.diskLabel || current} (not connected)`;
    opt.disabled = true;
    diskEl.appendChild(opt);
  }

  for (const v of volumes) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = optionLabel(v);
    diskEl.appendChild(opt);
  }

  diskEl.value = current || (volumes[0] && volumes[0].id) || '';
}

function requestVolumes() {
  diskEl.innerHTML = '<option value="">Loading disks…</option>';
  $UD.sendToPlugin({ type: 'listVolumes' });
}

function save() {
  if (!loaded) return;
  const id = diskEl.value;
  const vol = volumes.find((v) => v.id === id);
  settings = {
    ...settings,
    diskId: id,
    diskLabel: vol ? vol.label : settings.diskLabel || '',
  };
  lastSent = settings.diskId;
  $UD.setSettings(settings);
}

$UD.connect();

$UD.onConnected(() => {
  $UD.getSettings();
  requestVolumes();
  // Fallback: if the deck never answers (brand-new button with no saved
  // settings), unblock saving so a user pick still persists.
  setTimeout(() => { loaded = true; }, 600);
  document.querySelector('.udpi-wrapper').classList.remove('hidden');
});

$UD.onDidReceiveSettings((msg) => {
  const p = msg && (msg.param || msg.settings);
  if (p && 'diskId' in p) {
    const isSelfEcho = loaded && lastSent !== null && (p.diskId || '') === lastSent;
    settings = p;
    loaded = true;
    if (!isSelfEcho) renderOptions();
  } else {
    loaded = true;
  }
});

$UD.onSendToPropertyInspector((msg) => {
  const payload = msg && msg.payload;
  if (!payload || payload.type !== 'volumes') return;
  volumes = Array.isArray(payload.volumes) ? payload.volumes : [];
  renderOptions();
});

diskEl.addEventListener('change', save);
refreshBtn.addEventListener('click', requestVolumes);
