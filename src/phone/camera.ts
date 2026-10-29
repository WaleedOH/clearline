// The phone side: opens the rear camera, and once a second sends a 1280x720 JPEG to the laptop.

const WIDTH = 1280;
const HEIGHT = 720;
const INTERVAL_MS = 1000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const statusLine = $('status');
const canvas = Object.assign(document.createElement('canvas'), { width: WIDTH, height: HEIGHT });
const ctx = canvas.getContext('2d')!;

function cameraId(): string {
  const make = () => `PHONE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  try {
    const saved = localStorage.getItem('clearline.cameraId');
    if (saved) return saved;
    const id = make();
    localStorage.setItem('clearline.cameraId', id);
    return id;
  } catch {
    return make();
  }
}

function setStatus(text: string, kind: 'ok' | 'bad' | '' = '') {
  statusLine.textContent = text;
  statusLine.className = kind;
}

/** Draws the video centre-cropped to 16:9, so every phone sends the same frame shape. */
function grab(): Promise<Blob | null> {
  const vw = video.videoWidth, vh = video.videoHeight;
  const scale = Math.max(WIDTH / vw, HEIGHT / vh);
  const sw = WIDTH / scale, sh = HEIGHT / scale;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, WIDTH, HEIGHT);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

let stream: MediaStream | null = null;
let timer = 0;
let wakeLock: { release(): Promise<void> } | null = null;

async function start(name: string, code: string) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('This page needs a secure (https) address to use the camera. Open the https link from the control room.', 'bad');
    return;
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  try {
    // Keeps the screen (and so the camera) on while it's propped up.
    wakeLock = await (navigator as any).wakeLock?.request('screen') ?? null;
  } catch {
    wakeLock = null;
  }

  const id = cameraId();
  let sending = false;
  timer = window.setInterval(async () => {
    if (sending || !video.videoWidth) return;
    sending = true;
    try {
      const blob = await grab();
      if (!blob) return;
      const res = await fetch('/api/phone/frame', {
        method: 'POST',
        headers: { 'x-camera-id': id, 'x-camera-name': encodeURIComponent(name), 'x-join-code': code },
        body: blob,
      });
      if (res.ok) setStatus(`Live as ${name} (${id}) · last picture ${new Date().toLocaleTimeString()}`, 'ok');
      else setStatus((await res.json()).error ?? `Upload failed (${res.status})`, 'bad');
    } catch {
      setStatus('Can’t reach the laptop. Check both are on the same Wi-Fi.', 'bad');
    } finally {
      sending = false;
    }
  }, INTERVAL_MS);
}

function stop() {
  clearInterval(timer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  wakeLock?.release().catch(() => {});
  $('live').hidden = true;
  $('join').hidden = false;
}

$('join').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(e.currentTarget as HTMLFormElement);
  $('join').hidden = true;
  $('live').hidden = false;
  setStatus('Starting camera…');
  try {
    await start(String(data.get('name')).trim() || 'Phone', String(data.get('code')).trim());
  } catch (err) {
    setStatus(`Camera couldn’t start: ${err instanceof Error ? err.message : err}`, 'bad');
  }
});
$('stop').addEventListener('click', stop);
