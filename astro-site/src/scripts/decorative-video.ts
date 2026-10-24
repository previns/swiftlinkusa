// Keep decorative MP4 requests out of the initial page load on small screens,
// reduced-motion devices, and connections that request reduced data usage.
export function pauseMotionByDefault() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    window.matchMedia('(max-width: 767px)').matches || Boolean(connection?.saveData);
}

export function playDecorativeVideo(video: HTMLVideoElement) {
  const sources = video.querySelectorAll<HTMLSourceElement>('source[data-src]');
  if (sources.length) {
    sources.forEach(source => {
      source.src = source.dataset.src!;
      delete source.dataset.src;
    });
    video.load();
  }
  video.play().catch(() => { /* Autoplay may be disabled by the browser. */ });
}
