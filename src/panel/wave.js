// The wave along the bottom edge of what plays: a row, a tree's cell, an entry
// of the stack. The view only puts the line there (`.wave`, named by what
// plays: `data-wave`) inside something that is `.playing` or is not; here the
// line is made to live. Rows are drawn anew all the time and only while in
// sight, so nothing about a wave is kept in the page: its state is here, by
// name, and each frame finds the lines that are in the page now.
// One loop for all the waves; it stops by itself when nothing plays or the
// panel is not seen.

const still = matchMedia('(prefers-reduced-motion: reduce)');
const waves = new Map(); // Name -> { height: 0..1, as it is now; target: where it glides to; nextPick: when to choose another; phase: how far the wave has run }.
const rand = (from, to) => from + Math.random() * (to - from);

/**
 * The line's 41 points, on a field 100 wide and 6 tall: a running sine,
 * shaped by a second, slow one - so the wave is higher in one place and
 * lower in another, and that place drifts. Like sound, not like a spring.
 */
function points({ height, phase }) {
  let all = '';
  for (let i = 0; i <= 40; i++) {
    const y = 3 - height * 2.3 * Math.sin(i * 0.42 + phase) * (0.6 + 0.4 * Math.sin(i * 0.13 - phase * 0.7));
    all += `${i * 2.5},${y.toFixed(2)} `;
  }
  return all;
}

/** The lines in the page now, by name: { playing, lines }. (One page may have several: a row in each of two trees, a row and an entry of the stack.) */
function inPage() {
  const found = new Map();
  for (const el of document.querySelectorAll('.wave')) {
    const at = found.get(el.dataset.wave) ?? { playing: false, lines: [] };
    at.playing ||= el.parentElement.classList.contains('playing');
    at.lines.push(el.querySelector('polyline'));
    found.set(el.dataset.wave, at);
  }
  return found;
}

const show = (lines, wave) => {
  const all = points(wave);
  for (const line of lines) line.setAttribute('points', all);
};

let running = false;
let last = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const found = inPage();
  for (const name of waves.keys()) if (!found.has(name)) waves.delete(name); // Out of sight: when it is back, it rises again.
  for (const [name, { playing, lines }] of found) {
    if (!waves.has(name) && playing) waves.set(name, { height: 0, target: 0, nextPick: 0, phase: 0 });
    const wave = waves.get(name);
    if (!wave) continue;
    if (!playing) wave.target = 0; // The sound has stopped: the wave settles into a straight line (and fades: see .wave in panel.css).
    else if (now > wave.nextPick) {
      // A new height at random, every now and then: that is the life in it. Gliding to it is what keeps it from twitching.
      wave.target = rand(0.35, 1);
      wave.nextPick = now + rand(120, 260);
    }
    wave.height += (wave.target - wave.height) * (1 - Math.exp(-dt * 7));
    wave.phase += dt * 5.5;
    if (!playing && wave.height < 0.004) {
      wave.height = 0;
      waves.delete(name);
    }
    show(lines, wave);
  }
  if (waves.size && !document.hidden) requestAnimationFrame(frame);
  else running = false;
}

/** To be called whenever what plays, or what is in the page, may have changed: after every drawing. */
export function wake() {
  if (still.matches) {
    // No motion asked for: the sign stays, a wave standing still.
    for (const { playing, lines } of inPage().values()) show(lines, { height: playing ? 0.7 : 0, phase: 0 });
    return;
  }
  if (running || document.hidden || !(waves.size || document.querySelector('.playing > .wave'))) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', wake);
