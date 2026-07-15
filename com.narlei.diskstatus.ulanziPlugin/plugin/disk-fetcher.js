import { execFile } from 'child_process';

const EXEC_OPTS = { timeout: 8000, maxBuffer: 4 * 1024 * 1024 };

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, EXEC_OPTS, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function isMac() {
  return process.platform === 'darwin';
}

function isWindows() {
  return process.platform === 'win32';
}

// macOS/Linux: parse `df -k -P`, one row per mounted filesystem, in 1024-byte
// blocks. -P forces POSIX single-line output so long device names never wrap.
async function listVolumesPosix() {
  const out = await run('df', ['-k', '-P']);
  const lines = out.trim().split('\n').slice(1);
  const volumes = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [filesystem, blocks1k, used1k, avail1k] = parts;
    const mount = parts.slice(5).join(' ');

    const isUserVolume =
      mount === '/' ||
      mount.startsWith('/Volumes/') ||
      mount.startsWith('/media/') ||
      mount.startsWith('/mnt/') ||
      mount.startsWith('/run/media/');
    if (!isUserVolume) continue;
    if (filesystem === 'devfs' || filesystem === 'tmpfs' || filesystem === 'overlay') continue;

    const total = Number(blocks1k) * 1024;
    const free = Number(avail1k) * 1024;
    if (!Number.isFinite(total) || total <= 0) continue;

    // On macOS every APFS volume shares its container's free space, and df's
    // "used" column reflects only that volume's own blocks (for the sealed "/"
    // boot volume that's just a few GB — misleading). Deriving used from
    // total − free gives the container-wide "in use" figure that Disk Utility
    // shows. On Linux keep df's used column, which already accounts for the
    // root-reserved blocks that total − free would wrongly count as used.
    const used = isMac() ? Math.max(0, total - free) : Number(used1k) * 1024;

    volumes.push({
      id: mount,
      label: mount === '/' ? await macVolumeLabel(mount) : mount.split('/').pop(),
      mount,
      filesystem,
      total,
      used,
      free,
    });
  }

  return volumes;
}

// `diskutil info` gives the human-readable "Volume Name" for the boot disk
// (e.g. "Macintosh HD") — df only reports the raw mount point ("/").
async function macVolumeLabel(mount) {
  if (!isMac()) return mount === '/' ? 'Root' : mount;
  try {
    const out = await run('diskutil', ['info', mount]);
    const m = out.match(/Volume Name:\s*(.+)/);
    if (m && m[1].trim()) return m[1].trim();
  } catch {
    // fall through to default label below
  }
  return 'Macintosh HD';
}

// Windows: Get-Volume reports every mounted drive letter with its label and
// capacity in bytes already, no unit conversion needed.
async function listVolumesWindows() {
  const script =
    "Get-Volume | Where-Object { $_.DriveLetter } | " +
    "Select-Object DriveLetter,FileSystemLabel,Size,SizeRemaining | ConvertTo-Json -Compress";
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const parsed = JSON.parse(out.trim() || '[]');
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .filter((r) => r && r.DriveLetter)
    .map((r) => {
      const total = Number(r.Size) || 0;
      const free = Number(r.SizeRemaining) || 0;
      const drive = `${r.DriveLetter}:`;
      return {
        id: drive,
        label: r.FileSystemLabel && r.FileSystemLabel.trim() ? r.FileSystemLabel.trim() : drive,
        mount: drive,
        filesystem: 'NTFS',
        total,
        used: Math.max(0, total - free),
        free,
      };
    });
}

export async function listVolumes() {
  const volumes = isWindows() ? await listVolumesWindows() : await listVolumesPosix();
  // Attach pre-formatted labels so the Property Inspector (a webview that can't
  // tell which byte base this OS uses) renders exactly what the button shows.
  for (const v of volumes) {
    v.usedLabel = formatBytes(v.used);
    v.freeLabel = formatBytes(v.free);
    v.totalLabel = formatBytes(v.total);
  }
  // Largest/root volume first so the default selection (no saved settings yet)
  // is always the main system disk.
  return volumes.sort((a, b) => (b.mount === '/' || b.mount === 'C:' ? 1 : 0) - (a.mount === '/' || a.mount === 'C:' ? 1 : 0));
}

export async function getVolume(id) {
  const volumes = await listVolumes();
  return volumes.find((v) => v.id === id) || null;
}

export function defaultVolumeId() {
  return isWindows() ? 'C:' : '/';
}

// Byte base for display. macOS Finder / System Settings and most of Linux use
// decimal units (1 GB = 1000 MB), so a "256 GB" drive reads as ~245 in binary
// units — matching those apps means dividing by 1000. Windows Explorer instead
// labels binary units "GB", so keep 1024 there to match what Windows shows.
const BYTE_BASE = process.platform === 'win32' ? 1024 : 1000;

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unit = 0;
  while (value >= BYTE_BASE && unit < units.length - 1) {
    value /= BYTE_BASE;
    unit++;
  }
  // Promote when the value would otherwise round to a 4-digit number in the
  // smaller unit (e.g. 999.99 GB → "1 TB", matching how macOS labels it).
  if (value >= BYTE_BASE - 0.5 && unit < units.length - 1) {
    value /= BYTE_BASE;
    unit++;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
