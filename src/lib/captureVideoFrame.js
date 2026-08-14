// Grabs one frame from a video file (or any Blob of video bytes) as a
// small JPEG data URL, entirely in the browser — used as a guaranteed
// thumbnail source since Drive often never generates its own for videos
// uploaded via the API (unlike images, which almost always get one).
// Best-effort: resolves to null instead of throwing if the browser can't
// decode this particular video, so a capture failure never blocks the
// caller (an upload, or the backfill tool moving on to the next file).
const THUMB_MAX_DIM = 480;

export function captureVideoFrame(fileOrBlob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(fileOrBlob);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url;

    let done = false;
    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.remove();
      resolve(result);
    }

    // Some videos (bad codec, corrupt file, browser can't decode) never
    // fire the events below — don't let one bad file hang the caller.
    const timer = setTimeout(() => finish(null), 8000);

    video.addEventListener("error", () => finish(null));
    video.addEventListener("loadedmetadata", () => {
      // A hair into the video rather than frame 0, which is often just a
      // black/blank flash frame on phone-recorded footage.
      const seekTo = Number.isFinite(video.duration) ? Math.min(0.3, video.duration / 2) : 0;
      try {
        video.currentTime = seekTo;
      } catch {
        finish(null);
      }
    });
    video.addEventListener("seeked", () => {
      try {
        const scale = Math.min(1, THUMB_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return finish(null);
            const reader = new FileReader();
            reader.onload = () => finish(reader.result);
            reader.onerror = () => finish(null);
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          0.7
        );
      } catch {
        finish(null);
      }
    });
  });
}
