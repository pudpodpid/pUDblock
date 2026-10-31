// Test helper for the real-browser suites. Real DOM/messages/mutation observers
// run unchanged; only decoded media ranges/seek events are controlled here.
export function installPlayerFixture() {
  let end = 10;
  let position = 1;
  const root = document.createElement('div');
  root.className = 'video-player';
  root.style.cssText = 'position:relative;width:640px;height:360px;background:#444';
  root.id = 'root';
  document.body.append(root);
  const addVideo = (muted = false) => {
    const video = document.createElement('video');
    video.muted = muted;
    Object.defineProperties(video, {
      buffered: { get: () => ({ length: 1, start: () => 0, end: () => end }) },
      seekable: { get: () => ({ length: 1, start: () => 0, end: () => end }) },
      seeking: { get: () => false },
      currentTime: { get: () => position, set: value => { position = value; setTimeout(() => video.dispatchEvent(new Event('seeked')), 0); } }
    });
    video.requestVideoFrameCallback = callback => setTimeout(callback, 0);
    root.append(video);
    return video;
  };
  let video = addVideo();
  let resets = 0;
  root.__reactContainerFixture = { child: { stateNode: {
    setInitialPlaybackSettings() {},
    setSrc() { resets++; }
  } } };
  window.playerFixture = {
    get resets() { return resets; },
    get hidden() { return getComputedStyle(video).visibility === 'hidden'; },
    get muted() { return video.muted; },
    get overlay() { return Boolean(root.querySelector('[data-pudblock-waiting]')); },
    get position() { return position; },
    advance(value = 2) { end += value; },
    replace() { video.remove(); end = 2; video = addVideo(true); },
    unmute() { video.muted = false; video.dispatchEvent(new Event('volumechange')); },
    get route() { return location.pathname; }
  };
}
