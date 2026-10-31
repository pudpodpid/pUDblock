/*
 * Portions adapted from MIT-licensed playlist-filtering code.
 * Copyright (c) 2026 dhawal-ss. See licenses/playlist-engine.txt and NOTICE.md.
 */
(() => {
  "use strict";

  const HEADER = /^#(?:EXTM3U$|EXT-X-(?:VERSION:|TARGETDURATION:|MEDIA-SEQUENCE:|DISCONTINUITY-SEQUENCE:|PLAYLIST-TYPE:|INDEPENDENT-SEGMENTS$|ALLOW-CACHE:|START:|TWITCH-(?:LIVE-SEQUENCE:|ELAPSED-SECS:|TOTAL-SECS:)))/;
  const AD = /stitched|#EXT-X-CUE-OUT|#EXTINF:[^\n]*,Amazon(?:\||\s|$)/i;
  const PREFETCH = /^#EXT-X-(?:TWITCH-PREFETCH|PREFETCH|PRELOAD-HINT|PART):/;
  const TOKEN_QUERY = "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }";

  function linesOf(text) { return text.replace(/^\uFEFF/, "").split(/\r?\n/).map(line => line.trim()); }
  function containsAds(text) { return AD.test(text); }
  function isPlaylist(text) { return text.trimStart().startsWith("#EXTM3U"); }
  function isMaster(text) { return /^#EXT-X-STREAM-INF:/m.test(text); }
  function segmentCount(text) { return linesOf(text).filter(line => line && !line.startsWith("#")).length; }
  function numberHeader(lines, name) {
    const line = lines.find(item => item.startsWith(name));
    if (!line) return null;
    const number = Number(line.slice(name.length));
    return Number.isFinite(number) ? number : null;
  }
  function setHeader(lines, name, value) {
    const index = lines.findIndex(line => line.startsWith(name));
    if (index >= 0) lines[index] = name + value;
    else lines.splice(1, 0, name + value);
  }
  function attributes(line) {
    const result = {};
    const value = line.slice(line.indexOf(":") + 1);
    for (const match of value.matchAll(/(?:^|,)([\w-]+)=("[^"]*"|[^,]*)/g)) {
      result[match[1]] = match[2].replace(/^"|"$/g, "");
    }
    return result;
  }
  function absoluteUri(uri, base) {
    const result = new URL(uri, base);
    if (result.protocol !== "https:" && result.protocol !== "http:") throw new Error("Unsupported playlist URI");
    return result.href;
  }
  function absolutize(text, base) {
    return linesOf(text).map(line => {
      if (!line || line.startsWith("#") === false) return line ? absoluteUri(line, base) : line;
      return line.replace(/\bURI="([^"]+)"/g, (_, uri) => `URI="${absoluteUri(uri, base)}"`);
    }).join("\n");
  }
  function parseVariants(text, base) {
    const lines = linesOf(text);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
      const attrs = attributes(lines[i]);
      let next = i + 1;
      while (next < lines.length && (!lines[next] || lines[next].startsWith("#"))) next++;
      if (next === lines.length) continue;
      variants.push({
        url: absoluteUri(lines[next], base),
        resolution: attrs.RESOLUTION || "",
        frameRate: Number(attrs["FRAME-RATE"]) || 0,
        codecs: attrs.CODECS || "",
        audio: attrs.AUDIO || "",
        bandwidth: Number(attrs.BANDWIDTH) || 0
      });
    }
    return variants;
  }
  function selectVariant(variants, target) {
    // Mixing codecs, video sizes or frame rates can break the browser's decoder.
    // The browser port deliberately requires a matching rendition.
    return variants.find(item => item.resolution === target.resolution &&
      Math.abs(item.frameRate - target.frameRate) < 0.2 &&
      (!target.codecs || item.codecs === target.codecs) &&
      (target.resolution || item.audio === target.audio));
  }

  function describeVariant(target) {
    const resolution = /^\d{1,5}x\d{1,5}$/.test(target.resolution || "") ? target.resolution : "audio";
    const fps = Number.isFinite(target.frameRate) && target.frameRate > 0 && target.frameRate <= 240 ? ` @ ${target.frameRate} fps` : "";
    // Never include playlist URLs, arbitrary headers or server error bodies.
    const codecs = String(target.codecs || "").split(",").map(value => value.trim()).filter(value => /^(?:avc[13](?:\.[a-f\d]{6})?|av01\.[a-z\d.]{1,24}|(?:hvc1|hev1)\.[a-z\d.]{1,40}|vp09\.[\d.]{1,30}|mp4a\.[a-f\d.]{1,15}|opus)$/i.test(value)).slice(0, 3).join(" + ");
    return `${resolution}${fps}${codecs ? " (" + codecs + ")" : ""}`;
  }
  function playbackTokenRequest(channel, playerType) {
    if (!/^[a-z0-9_]{1,40}$/i.test(channel || "") || !["popout", "embed"].includes(playerType)) throw new Error("Invalid playback token request");
    return {
      url: "https://gql.twitch.tv/gql",
      init: {
        method: "POST",
        headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "application/json" },
        body: JSON.stringify({ operationName: "PlaybackAccessToken_Template", query: TOKEN_QUERY,
          variables: { login: channel, isLive: true, vodID: "", isVod: false, playerType } })
      }
    };
  }
  function requestFailure(error, signal, stage) {
    if (signal?.aborted) return signal.reason === "backup-timeout" ? `timed out requesting ${stage}` : `cancelled while requesting ${stage}`;
    if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) return `HTTP ${error.status} requesting ${stage}`;
    const known = { token: "no playback token returned", playlist: "invalid master playlist", variants: "no supported video qualities", size: "response exceeded size limit", "page-transport": "Twitch page helper unavailable; reload the Twitch tab", "page-timeout": "Twitch page request timed out", "page-response": "invalid response from Twitch page helper", "page-busy": "Twitch page request helper is busy" };
    return known[error?.reason] || (error?.name === "SyntaxError" ? `invalid response requesting ${stage}` : `network failure requesting ${stage}`);
  }

  function startsWithAdTail(lines) {
    let segment = false;
    let boundary = false;
    for (const line of lines) {
      if ((line.startsWith("#EXT-X-DATERANGE:") && /stitched/i.test(line)) || line.startsWith("#EXT-X-CUE-OUT")) return segment && boundary;
      if (line === "#EXT-X-DISCONTINUITY" && segment) boundary = true;
      if (line && !line.startsWith("#")) segment = true;
    }
    return false;
  }

  function durationAttribute(line) {
    const match = /(?:^|[,:])DURATION=([\d.]+)/.exec(line);
    return match ? Number(match[1]) || 0 : 0;
  }

  function persistentSegmentTags(rawLines, end) {
    const result = new Map();
    for (const line of rawLines.slice(0, end)) {
      if (line.startsWith("#EXT-X-KEY:")) result.set("key", line);
      if (line.startsWith("#EXT-X-MAP:")) result.set("map", line);
    }
    return [...result.values()];
  }

  function rewritePass(text, assumeStartInAd) {
    const lines = linesOf(text);
    let cleaned = [];
    const retained = [];
    let rawIndex = -1;
    let lastRemoved = -1;
    let inAd = assumeStartInAd;
    let podSegments = 0;
    let target = 0;
    let consumed = 0;
    let duration = 2;
    let removed = 0;
    const splice = () => {
      if (cleaned.at(-1) !== "#EXT-X-DISCONTINUITY") cleaned.push("#EXT-X-DISCONTINUITY");
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const uri = line && !line.startsWith("#");
      if (uri) rawIndex++;
      if (HEADER.test(line)) { cleaned.push(line); continue; }
      if (PREFETCH.test(line)) continue;
      if ((line.startsWith("#EXT-X-DATERANGE:") && /stitched/i.test(line)) || line.startsWith("#EXT-X-CUE-OUT")) {
        if (!inAd) { inAd = true; podSegments = 0; consumed = 0; target = 0; }
        target = Math.max(target, durationAttribute(line) || (line.startsWith("#EXT-X-CUE-OUT:") ? Number(line.split(":")[1]) || 0 : 0));
      } else if (line.startsWith("#EXT-X-CUE-IN")) {
        if (inAd) { inAd = false; target = 0; splice(); }
      } else if (line === "#EXT-X-DISCONTINUITY") {
        if (inAd) {
          if (podSegments > 0 && (!target || consumed + 0.001 >= target)) { inAd = false; target = 0; splice(); }
        } else splice();
      } else if (line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-MAP:")) {
        cleaned.push(line);
      } else if (line.startsWith("#EXTINF:") && /,Amazon(?:\||\s|$)/i.test(line)) {
        // Covers a sliding window whose opening ad marker has scrolled away.
        if (!inAd) { inAd = true; podSegments = 0; target = 0; consumed = 0; }
        duration = Number(line.slice(8).split(",")[0]) || 2;
      } else if (inAd && line.startsWith("#EXTINF:")) {
        duration = Number(line.slice(8).split(",")[0]) || 2;
      } else if (inAd && uri) {
        removed++; podSegments++; lastRemoved = rawIndex; consumed += duration; duration = 2;
      } else if (inAd && line !== "#EXT-X-ENDLIST") {
        // Drop all other per-ad tags together with their segment URI.
      } else {
        cleaned.push(line);
        if (uri) retained.push({ rawIndex, rawLine: i, cleanedLine: cleaned.length - 1 });
      }
    }
    // Keep original sequence identity by discarding the already played prefix
    // once post-ad content exists.
    const mediaSequence = numberHeader(lines, "#EXT-X-MEDIA-SEQUENCE:");
    const first = retained.find(segment => segment.rawIndex > lastRemoved);
    if (lastRemoved >= 0 && mediaSequence !== null && first) {
      const previous = retained.filter(segment => segment.cleanedLine < first.cleanedLine).at(-1);
      let suffix = cleaned.slice(previous ? previous.cleanedLine + 1 : 0).filter(line => !HEADER.test(line));
      const firstUri = suffix.findIndex(line => line && !line.startsWith("#"));
      suffix = suffix.filter((line, i) => !(i < firstUri && (line === "#EXT-X-DISCONTINUITY" || line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-MAP:"))));
      const headers = cleaned.filter(line => HEADER.test(line));
      setHeader(headers, "#EXT-X-MEDIA-SEQUENCE:", mediaSequence + first.rawIndex);
      const discontinuities = lines.slice(0, first.rawLine).filter(line => line === "#EXT-X-DISCONTINUITY").length;
      setHeader(headers, "#EXT-X-DISCONTINUITY-SEQUENCE:", (numberHeader(lines, "#EXT-X-DISCONTINUITY-SEQUENCE:") || 0) + discontinuities);
      const liveSequence = numberHeader(lines, "#EXT-X-TWITCH-LIVE-SEQUENCE:");
      if (liveSequence !== null) setHeader(headers, "#EXT-X-TWITCH-LIVE-SEQUENCE:", liveSequence + first.rawIndex);
      const elapsed = numberHeader(lines, "#EXT-X-TWITCH-ELAPSED-SECS:");
      if (elapsed !== null) {
        const seconds = lines.slice(0, first.rawLine).filter(line => line.startsWith("#EXTINF:")).slice(0, first.rawIndex).reduce((sum, line) => sum + (Number(line.slice(8).split(",")[0]) || 0), 0);
        setHeader(headers, "#EXT-X-TWITCH-ELAPSED-SECS:", elapsed + seconds);
      }
      cleaned = [...headers, ...persistentSegmentTags(lines, first.rawLine), ...suffix];
    }
    return { content: cleaned.join("\n"), removed };
  }

  function stripAds(text) {
    if (!containsAds(text)) return { content: text, removed: 0 };
    const result = rewritePass(text, false);
    if (result.removed === 0 || startsWithAdTail(linesOf(text))) return rewritePass(text, true);
    return result;
  }

  class Timeline {
    constructor(maxEntries = 128) { this.floors = new Map(); this.lastClean = new Map(); this.maxEntries = maxEntries; }
    clear() { this.floors.clear(); this.lastClean.clear(); }
    normalize(key, text, { candidate = false } = {}) {
      const lines = linesOf(text);
      const original = numberHeader(lines, "#EXT-X-MEDIA-SEQUENCE:");
      if (original === null) return text;
      const elapsed = numberHeader(lines, "#EXT-X-TWITCH-ELAPSED-SECS:");
      const canonical = numberHeader(lines, "#EXT-X-TWITCH-LIVE-SEQUENCE:") ?? (elapsed === null ? original : Math.round(elapsed / 2));
      setHeader(lines, "#EXT-X-MEDIA-SEQUENCE:", canonical);
      const floor = this.floors.get(key) ?? canonical;
      const uris = lines.map((line, i) => line && !line.startsWith("#") ? i : -1).filter(i => i >= 0);
      const drop = Math.min(Math.max(0, floor - canonical), uris.length);
      // Reject a stale backup without changing the timeline. An all-trimmed
      // primary window must likewise never become an empty media playlist.
      if (uris.length && drop === uris.length) return candidate ? null : (this.lastClean.get(key) || text);
      let output = lines;
      if (drop) {
        const cut = uris[drop - 1] + 1;
        const prefix = lines.slice(0, cut);
        const headers = lines.filter(line => HEADER.test(line));
        // Do not advance past all the segments in a stale backup window.
        setHeader(headers, "#EXT-X-MEDIA-SEQUENCE:", canonical + drop);
        if (numberHeader(lines, "#EXT-X-TWITCH-LIVE-SEQUENCE:") !== null) setHeader(headers, "#EXT-X-TWITCH-LIVE-SEQUENCE:", canonical + drop);
        const discontinuities = prefix.filter(line => line === "#EXT-X-DISCONTINUITY").length;
        if (discontinuities || numberHeader(lines, "#EXT-X-DISCONTINUITY-SEQUENCE:") !== null) setHeader(headers, "#EXT-X-DISCONTINUITY-SEQUENCE:", (numberHeader(lines, "#EXT-X-DISCONTINUITY-SEQUENCE:") || 0) + discontinuities);
        if (elapsed !== null) setHeader(headers, "#EXT-X-TWITCH-ELAPSED-SECS:", elapsed + prefix.filter(line => line.startsWith("#EXTINF:")).reduce((sum, line) => sum + (Number(line.slice(8).split(",")[0]) || 0), 0));
        output = [...headers, ...persistentSegmentTags(lines, cut), ...lines.slice(cut).filter(line => !HEADER.test(line))];
      }
      this.floors.delete(key);
      this.floors.set(key, Math.max(floor, canonical));
      const result = output.join("\n");
      if (uris.length && !containsAds(result)) this.lastClean.set(key, result);
      while (this.floors.size > this.maxEntries) {
        const oldest = this.floors.keys().next().value;
        this.floors.delete(oldest); this.lastClean.delete(oldest);
      }
      return result;
    }
  }

  function compatibleTimeline(primary, backup) {
    // Both sessions need a broadcast-wide anchor; arbitrary local sequence
    // numbers cannot safely be substituted into the web player's session.
    const anchored = text => /^#EXT-X-TWITCH-(?:LIVE-SEQUENCE|ELAPSED-SECS):/m.test(text);
    if (!anchored(primary) || !anchored(backup)) return false;
    const encrypted = text => /^#EXT-X-KEY:(?!METHOD=NONE)/m.test(text);
    return !encrypted(primary) && !encrypted(backup);
  }

  class BackupResolver {
    constructor(fetcher = fetch, now = Date.now) {
      this.fetcher = fetcher; this.now = now; this.cache = new Map(); this.pending = new Map();
    }
    clear() { this.cache.clear(); this.pending.clear(); }
    async fetchText(url, signal, init = {}) {
      const response = await this.fetcher(url, { ...init, signal, credentials: "omit", cache: "no-store", redirect: "error" });
      if (!response.ok) throw Object.assign(new Error("Upstream request failed"), { status: response.status });
      const text = await response.text();
      if (text.length > 1024 * 1024) throw Object.assign(new Error("Oversized playlist"), { reason: "size" });
      return text;
    }
    async master(channel, playerType, signal, apiVersion = 1, details = {}) {
      const key = `${channel}|${playerType}|${apiVersion}`;
      const cached = this.cache.get(key);
      if (cached && cached.expires > this.now()) {
        if (!cached.variants) { details.failure = cached.failure; details.cooldown = true; }
        return cached.variants;
      }
      // A pending request is tied to its own caller's deadline. Other callers
      // can reuse its result, but cannot extend that original deadline.
      if (this.pending.has(key)) {
        const pending = this.pending.get(key);
        const result = await pending;
        Object.assign(details, pending.details);
        return result;
      }
      let operation;
      operation = (async () => {
        try {
          details.stage = "token";
          const tokenRequest = playbackTokenRequest(channel, playerType);
          const tokenText = await this.fetchText(tokenRequest.url, signal, tokenRequest.init);
          const token = JSON.parse(tokenText)?.data?.streamPlaybackAccessToken;
          if (!token?.signature || !token?.value) throw Object.assign(new Error("Playback token unavailable"), { reason: "token" });
          const url = new URL(`https://usher.ttvnw.net/api/${apiVersion === 2 ? "v2/" : ""}channel/hls/${encodeURIComponent(channel)}.m3u8`);
          url.search = new URLSearchParams({ sig: token.signature, token: token.value, allow_source: "true", allow_audio_only: "true", allow_spectre: "false", fast_bread: "true", p: String(Math.floor(Math.random() * 900000 + 100000)), player_backend: "mediaplayer", playlist_include_framerate: "true", reassignments_supported: "true", supported_codecs: "avc1", transcode_mode: "cbr_v1" });
          details.stage = "master playlist";
          const raw = await this.fetchText(url.href, signal);
          if (!isPlaylist(raw)) throw Object.assign(new Error("Invalid master playlist"), { reason: "playlist" });
          const variants = parseVariants(raw, url.href).filter(item => isTwitchStreamUrl(item.url));
          if (!variants.length) throw Object.assign(new Error("No compatible streams"), { reason: "variants" });
          this.cache.set(key, { variants, expires: this.now() + 90000 });
          return variants;
        } catch (error) {
          details.failure = requestFailure(error, signal, details.stage);
          // A player cancelling one refresh says nothing about whether a new
          // caller can fetch this backup. Firefox shares this resolver across
          // tabs/qualities; do not turn cancellation into a 15-second outage.
          if (!signal?.aborted && !["page-transport", "page-timeout", "page-busy", "page-response"].includes(error?.reason)) this.cache.set(key, { variants: null, failure: details.failure, expires: this.now() + 15000 });
          return null;
        } finally {
          if (this.pending.get(key) === operation) this.pending.delete(key);
          while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value);
        }
      })();
      operation.details = details;
      this.pending.set(key, operation);
      return operation;
    }
    async resolve(channel, target, primary, signal, apiVersion = 1, onDiagnostic = () => {}) {
      const attempts = [];
      try {
        for (const playerType of ["popout", "embed"]) {
          if (signal.aborted) {
            attempts.push(`${playerType}: ${signal.reason === "backup-timeout" ? "search deadline reached before attempt" : "search cancelled before attempt"}`);
            break;
          }
          const details = {};
          const variants = await this.master(channel, playerType, signal, apiVersion, details);
          if (!variants) { attempts.push(`${playerType}: ${details.failure || "master unavailable"}${details.cooldown ? " (retry cooldown)" : ""}`); continue; }
          const variant = selectVariant(variants, target);
          if (!variant) {
            const closest = variants.find(item => item.resolution === target.resolution);
            attempts.push(`${playerType}: no matching video format${closest ? "; available " + describeVariant(closest) : ""}`);
            continue;
          }
          try {
            const raw = await this.fetchText(variant.url, signal);
            if (!isPlaylist(raw) || isMaster(raw) || !segmentCount(raw)) {
              attempts.push(`${playerType}: not a usable video playlist`);
              if (!isPlaylist(raw)) this.cache.delete(`${channel}|${playerType}|${apiVersion}`);
            } else if (containsAds(raw)) attempts.push(`${playerType}: backup also contains ads`);
            else if (!compatibleTimeline(primary, raw)) attempts.push(`${playerType}: incompatible stream timing or encryption`);
            else {
              attempts.push(`${playerType}: clean matching backup`);
              return { content: absolutize(raw, variant.url), playerType };
            }
          } catch (error) {
            attempts.push(`${playerType}: ${requestFailure(error, signal, "video playlist")}`);
            if (!signal.aborted) this.cache.delete(`${channel}|${playerType}|${apiVersion}`);
          }
        }
        return null;
      } finally {
        try { onDiagnostic(`For ${describeVariant(target)} — ${attempts.join("; ")}`.slice(0, 700)); }
        catch { /* Local diagnostics must never interrupt playback. */ }
      }
    }
  }

  function isTwitchStreamUrl(value) {
    try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "ttvnw.net" || url.hostname.endsWith(".ttvnw.net")); }
    catch { return false; }
  }

  globalThis.StreamFilterCore = Object.freeze({ containsAds, isPlaylist, isMaster, segmentCount, attributes, absolutize, parseVariants, selectVariant, stripAds, Timeline, BackupResolver, isTwitchStreamUrl, compatibleTimeline, playbackTokenRequest });
})();
