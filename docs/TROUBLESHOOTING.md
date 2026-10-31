# Backup troubleshooting

Both browsers use the same backup-selection engine: anonymous popout/embed
streams must match the requested video size, frame rate and codecs and have
compatible live timing. A clean result is used; otherwise the player is hidden
and muted while waiting. Counters accumulate over a tab/channel session and do
not describe one unique advertisement.

## Firefox waits while Chrome gets a clean backup

1. Confirm **Try clean alternate streams** is enabled in Firefox and compare
   the selected Twitch video quality in both players.
2. In pUDblock 1.0.2 or newer, expand **Connection details** and read **Last
   backup search**. It records the requested format and outcome for each
   attempted player type, with the time of the last search.
3. Record that text, the browser/extension version, channel and time if the
   difference recurs. The diagnostic omits signed URLs and playback tokens;
   raw network logs are not needed.

Possible outcomes:

| Diagnostic | Meaning |
| --- | --- |
| HTTP status requesting token/master/video playlist | Twitch or its CDN rejected that stage of the lookup. |
| Network failure | The request could not complete; the report does not claim a specific network/CORS cause. Firefox 1.0.2 used background fetch; 1.0.3 uses Twitch-page fetch. |
| Twitch page helper unavailable | Reload the Twitch tab after updating to attach the new page helper. |
| Timed out / search deadline reached | The four-second budget ended; a later player type may not have been tried. |
| Cancelled | A player request or settings change cancelled the lookup. |
| Retry cooldown | A real failed master lookup is temporarily cached to avoid repeated token requests. |
| Backup also contains ads | That alternate session did not provide clean video. |
| No matching video format | Available qualities did not match the requested resolution, frame rate and codec. |
| Incompatible timing or encryption | The backup could not be safely substituted into this stream. |
| Clean backup rejected as older | The backup window was already behind the player's current sequence floor. |

Earlier Firefox versions shared a backup resolver across tabs and qualities.
Version 1.0.3 isolates it by tab/frame/master session. Chrome uses separate
instances in the page and playback workers. Before 1.0.2, a cancelled lookup
could be remembered as a 15-second failure; cancellation no longer creates
that negative cache entry. This is a demonstrated bug, not a confirmed
explanation of every browser difference.

A later user report identified `network failure requesting token` for both
popout and embed in Firefox while Chrome succeeded. This fails before the
backup's video format or ad markers can be inspected. The exact network-layer
block was not established. Version 1.0.3 targets this path by originating the
anonymous requests from the Twitch page in both browsers, while retaining
Firefox's response-filter implementation. A clean backup is still not guaranteed
if Twitch rejects page requests or both alternate sessions contain ads.

## Maintainer comparison tool

Run `node scripts/compare-backups.mjs caedrel` for an optional live comparison.
It uses fresh anonymous profiles and test-only copies, observes primary stream
formats and probes a Source-quality backup using Firefox's actual page bridge
and Chrome page fetch. It saves only sanitized summaries under `.test-artifacts/`.
It does not simulate a real Twitch ad break or reproduce an existing account's
session, cookies or network history.
