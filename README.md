# Still — Binaural Beats

## Open and play

Double-click **index.html** to open the app in your browser. On macOS, you can also double-click **Start.command**. No install, server, account, or internet connection is required to use the app.

1. Connect stereo headphones.
2. Use **Test left ear** and **Test right ear**. Each two-second check should sound only in the named ear. Turn off your device's mono audio setting if you hear it in both ears. Disable spatial audio or audio enhancements if they mix channels.
3. Choose a mode and press **Start session**. The default is 40 Hz. Begin at low volume.

| Mode | Difference | Left ear | Right ear |
| --- | --- | --- | --- |
| Delta | 2 Hz | 200 Hz | 202 Hz |
| Theta | 6 Hz | 200 Hz | 206 Hz |
| Alpha | 10 Hz | 200 Hz | 210 Hz |
| Beta | 20 Hz | 200 Hz | 220 Hz |
| Gamma | 40 Hz | 200 Hz | 240 Hz |

In **Manual** mode, the custom slider covers **1–40 Hz in 0.5 Hz steps**. Frequency and volume can be adjusted during playback. Session lengths are continuous, 5, 10, 20, 30, or 60 minutes. The table above uses the default 200 Hz carrier; you can also select 320 Hz or 400 Hz before starting. Stop ends a session; starting again starts a new one. Keep the browser open and your device awake for uninterrupted playback.

## Study mode: automatic 25/5 rounds

Open **Study · 25/5**, select your round count, and press **Start study**. The default is four rounds (two hours), using a 400 Hz left tone and a 440 Hz right tone during focus. You can select 1, 2, 4, or 8 rounds and a 200 Hz, 320 Hz, or 400 Hz carrier before starting.

| Time within each 30-minute round | Activity | Frequency difference |
| --- | --- | --- |
| 0:00–25:00 | Focus on one task | Hold 40 Hz |
| 25:00–25:30 | Begin your break | Gradually fall from 40 to 10 Hz |
| 25:30–29:30 | Rest, stretch, or look away from the screen | Hold 10 Hz |
| 29:30–30:00 | Prepare to return | Gradually rise from 10 to 40 Hz |
| 30:00 | Next round starts, or the selected session finishes | 40 Hz |

This is a simple Pomodoro-style 25/5 schedule. All breaks remain five minutes, including the last; after the selected rounds the audio stops and the app prompts a longer break. It does not automatically schedule the longer break used in the full [Pomodoro Technique](https://www.pomodorotechnique.com/). The 10 Hz break and 30-second ramps are product choices, not a validated brain-entrainment protocol or a promise of calm.

The live display shows phase, round, time remaining, and the current left/right frequencies during transitions. The browser tab title also shows the phase countdown. Volume remains adjustable during the session; manual frequency, carrier, round count, and mode changes require stopping first. Ear checks end the current session. **Pause session** fades the audio out and freezes the audio clock, phase countdown, and frequency transitions. **Resume session** fades back in and continues at the same point, during either focus or a break. Use it to extend a break without restarting. **Stop session** discards the session; starting again begins round one. Progress is not saved after closing or reloading the app.

Study audio plays continuously through focus, breaks, and frequency transitions. There are no automatic sound gaps or pre-break pauses. Use **Pause session** when you want to silence the sound and freeze the countdown.

Study transitions and the final fade-out are scheduled upfront on Web Audio's clock. Delayed JavaScript timers in a background tab cannot shift the audio schedule; the UI catches up when it runs again. Device sleep, browser suspension, or an audio interruption may still interrupt playback; the app stops when an unexpected audio-context interruption is reported rather than claiming the session continued. A deliberate pause is handled separately and retains the session.

The **320 Hz · study’s 340 Hz centre at 40 Hz** pitch option plays **320 Hz left / 360 Hz right** during focus. This matches the 40 Hz tone pair centred at 340 Hz in [Melnichuk and colleagues (2025)](https://www.nature.com/articles/s41598-025-88517-z). During the 10 Hz break it uses **320/330 Hz**; the left tone remains fixed, so the centre changes. This option reproduces that focus tone pair, not the study’s full experimental protocol. The existing 400 Hz study default is unchanged.

## Does the carrier pitch matter?

The **difference** determines the beat rate: 200/240 Hz and 400/440 Hz both have a 40 Hz difference. The **carrier frequencies** also affect the audible pitch and can affect the measured binaural response. They are not interchangeable in every physiological respect.

- [Schwarz and Taylor (2005)](https://pubmed.ncbi.nlm.nih.gov/15721080/) recorded a 40 Hz binaural auditory steady-state response at a mean stimulus frequency of 400 Hz, with no detectable response beyond 3 kHz under their experimental conditions. Their mean-400 Hz condition should not be confused with this app's 400/440 Hz pair, whose mean is 420 Hz.
- [Grose and Mamo (2012)](https://pubmed.ncbi.nlm.nih.gov/21926628/) compared 390/430 Hz with 810/850 Hz while holding the difference at 40 Hz. A binaural-beat response was consistently observed for the lower pair but not the higher pair, although the response fluctuated over time.

These studies do **not** establish that this app's 400/440 Hz setting improves studying more than 200/240 Hz. Study mode defaults to the requested higher-pitch option, with the original lower-pitch option available for comfort. An evoked auditory response is not evidence that the whole brain has adopted that frequency, and the app does not measure EEG.

## Actual stereo synthesis

`audio.js` generates two independent sine-wave oscillators using Web Audio. A two-input `ChannelMergerNode` routes the selected carrier exclusively to output channel 0 (left) and carrier + selected difference exclusively to channel 1 (right). `study.js` defines the study timeline and its display state; the audio engine schedules its holds and linear frequency ramps using AudioParam automation. The app never combines the two tones into mono before playback. See the [Web Audio channel merger documentation](https://developer.mozilla.org/en-US/docs/Web/API/ChannelMergerNode).

40 Hz is the frequency difference, not a 40 Hz tone sent to both ears. These are steady tones, not two separately pulsing recordings. The headphone checks mute one channel at a time. Start/stop fades and smooth frequency/volume changes reduce clicks. Timed endings are scheduled on the audio clock.

The app can control its digital stereo output, but device settings and headphone hardware determine what reaches each ear. The mode names are frequency labels, not promises of health, sleep, or concentration effects; perception can vary, particularly at the higher differences.

## Development and verification

Runtime files are `index.html`, `styles.css`, `audio.js`, `study.js`, and `app.js`; keep them together. `Start.command` is an optional macOS launcher. No runtime dependencies or build step.

Tests need Node.js and Google Chrome installed:

```sh
npm install
npm test
```

Tests use Playwright and a real browser's `OfflineAudioContext` to measure channel frequencies, reject cross-channel leakage, verify ear isolation and silence after stopping, validate inputs, and exercise the UI from a direct local file. Study tests check exact 25/5 boundaries, transition midpoints, repeats, completion, and invalid schedules. Audio continuity tests check every 10 ms window across accelerated focus/break cycles at all three carrier pitches. Browser checks verify that pause freezes the real audio clock and countdown, resume continues into the next round, and stopping while paused permits a clean restart. Accelerated versions of the same timeline verify rendered audio through focus, break, and return without waiting hours. Screenshots are written to `test-results/`.
