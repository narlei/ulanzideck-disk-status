import UlanziApi from './plugin-common-node/index.js';
import { listVolumes, getVolume, defaultVolumeId } from './disk-fetcher.js';
import { renderUsage, renderLoading, renderNoSelection, renderNotFound, renderError } from './renderer.js';

const PLUGIN_UUID = 'com.narlei.diskstatus.plugin';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
// Only flag data as stale once a whole extra poll cycle has been missed, so the
// warning dot never appears during the normal gap between 5-minute refreshes.
const STALE_THRESHOLD_SEC = 11 * 60;

const $UD = new UlanziApi();
const INSTANCES = new Map();

function log(...args) {
  console.log('[disk-status]', ...args);
}

function pushIcon(context, dataUrl) {
  $UD.setBaseDataIcon(context, dataUrl);
}

function diskIdFor(inst) {
  return inst.settings?.diskId || '';
}

function renderForInstance(inst) {
  const { context, lastResult } = inst;
  const diskId = diskIdFor(inst);

  if (!diskId) {
    pushIcon(context, renderNoSelection());
    return;
  }
  if (!lastResult) {
    pushIcon(context, renderLoading({ label: inst.settings?.diskLabel }));
    return;
  }
  if (lastResult.ok) {
    const v = lastResult.volume;
    const stale = Math.floor(Date.now() / 1000) - lastResult.fetchedAt;
    pushIcon(context, renderUsage({
      label: v.label,
      used: v.used,
      total: v.total,
      free: v.free,
      stale: stale > STALE_THRESHOLD_SEC ? stale : 0,
    }));
    return;
  }
  if (lastResult.kind === 'NOT_FOUND') {
    pushIcon(context, renderNotFound({ label: inst.settings?.diskLabel }));
    return;
  }
  pushIcon(context, renderError({ label: inst.settings?.diskLabel, msg: lastResult.message }));
}

async function refresh(inst) {
  const diskId = diskIdFor(inst);
  if (!diskId) {
    inst.lastResult = null;
    renderForInstance(inst);
    return;
  }
  if (inst.inflight) return;
  inst.inflight = true;
  try {
    const volume = await getVolume(diskId);
    if (!volume) {
      inst.lastResult = { ok: false, kind: 'NOT_FOUND' };
    } else {
      inst.lastResult = { ok: true, volume, fetchedAt: Math.floor(Date.now() / 1000) };
      // Keep the saved label in sync in case the volume was renamed.
      if (inst.settings && volume.label !== inst.settings.diskLabel) {
        inst.settings = { ...inst.settings, diskLabel: volume.label };
      }
    }
  } catch (e) {
    log('refresh failed', e?.message);
    inst.lastResult = { ok: false, kind: 'ERROR', message: e?.message || 'unknown error' };
  } finally {
    inst.inflight = false;
    renderForInstance(inst);
  }
}

function startPolling(inst) {
  stopPolling(inst);
  const jitter = Math.floor(Math.random() * 5000);
  inst.startTimer = setTimeout(() => {
    refresh(inst);
    inst.timer = setInterval(() => refresh(inst), POLL_INTERVAL_MS);
  }, jitter);
}

function stopPolling(inst) {
  if (inst.startTimer) { clearTimeout(inst.startTimer); inst.startTimer = null; }
  if (inst.timer) { clearInterval(inst.timer); inst.timer = null; }
}

function ensureInstance(context, settings) {
  let inst = INSTANCES.get(context);
  if (!inst) {
    inst = {
      context,
      settings: settings && Object.keys(settings).length ? settings : { diskId: defaultVolumeId() },
      lastResult: null,
      inflight: false,
      timer: null,
      startTimer: null,
      active: true,
    };
    INSTANCES.set(context, inst);
    renderForInstance(inst);
    startPolling(inst);
  } else if (settings && 'diskId' in settings) {
    const prevDiskId = diskIdFor(inst);
    inst.settings = settings;
    if (prevDiskId !== settings.diskId) {
      inst.lastResult = null;
      renderForInstance(inst);
      refresh(inst);
    }
  }
  return inst;
}

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => log('connected'));

$UD.onAdd((msg) => {
  log('add', msg.context, msg.param);
  ensureInstance(msg.context, msg.param || {});
});

$UD.onParamFromApp((msg) => {
  const inst = ensureInstance(msg.context, msg.param || {});
  renderForInstance(inst);
});

$UD.onParamFromPlugin((msg) => {
  const inst = ensureInstance(msg.context, msg.param || {});
  renderForInstance(inst);
});

// The Property Inspector's setSettings() call is delivered here — without this
// listener, picking a different disk in the PI never reaches the running
// instance on this side.
$UD.onDidReceiveSettings((msg) => {
  const settings = msg.settings || msg.param || {};
  log('didReceiveSettings', msg.context, settings);
  ensureInstance(msg.context, settings);
});

$UD.onRun((msg) => {
  const inst = INSTANCES.get(msg.context);
  if (!inst) {
    ensureInstance(msg.context, msg.param || {});
    return;
  }
  log('click -> force refresh', msg.context);
  refresh(inst);
});

$UD.onSetActive((msg) => {
  const inst = INSTANCES.get(msg.context);
  if (!inst) return;
  inst.active = !!msg.active;
  if (inst.active) {
    renderForInstance(inst);
    if (!inst.timer && !inst.startTimer) startPolling(inst);
  } else {
    stopPolling(inst);
  }
});

$UD.onClear((msg) => {
  if (!msg.param) return;
  for (const item of msg.param) {
    const ctx = item.context;
    const inst = INSTANCES.get(ctx);
    if (inst) {
      stopPolling(inst);
      INSTANCES.delete(ctx);
      log('clear', ctx);
    }
  }
});

// The Property Inspector cannot run shell commands itself, so it asks the
// Node-side plugin (here) to enumerate mounted volumes/drives on its behalf.
$UD.onSendToPlugin(async (msg) => {
  const payload = msg.payload || {};
  if (payload.type !== 'listVolumes') return;
  try {
    const volumes = await listVolumes();
    $UD.sendToPropertyInspector({ type: 'volumes', volumes }, msg.context);
  } catch (e) {
    log('listVolumes failed', e?.message);
    $UD.sendToPropertyInspector({ type: 'volumes', volumes: [], error: e?.message || 'unknown error' }, msg.context);
  }
});

$UD.onError((err) => log('socket error', err));
$UD.onClose(() => log('socket closed'));
