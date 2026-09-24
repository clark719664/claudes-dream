import test from 'node:test';
import assert from 'node:assert/strict';
import { Weather } from '../engine/game/weather.js';
import { skyForWeather } from '../engine/game/builder.js';
import { designFromPrompt, refineSpec } from '../shared/designer.js';
import { normalizeSpec } from '../shared/spec.js';

const run = (w, seconds, dt = 1 / 30) => {
  const frames = [];
  for (let t = 0; t < seconds; t += dt) frames.push(w.update(dt, [0, 0, 1]));
  return frames;
};

test('rainy worlds start soaked and dry out when the rain stops', () => {
  const w = new Weather();
  w.configure({ rain: 0.8 }, 7);
  assert.ok(w.wetness > 0.5);
  run(w, 5);
  assert.ok(w.wetness > 0.5);
  w.rain = 0;
  const before = w.wetness;
  run(w, 20);
  assert.ok(w.wetness < before, 'dries after the rain');
  assert.ok(w.wetness > 0.05, 'drying is slow');
});

test('light rain comes and goes in showers, heavy rain keeps pouring', () => {
  const light = new Weather();
  light.configure({ rain: 0.4 }, 1);
  const levels = run(light, 120, 0.5).map((f) => f.fx[1]);
  assert.ok(Math.max(...levels) - Math.min(...levels) > 0.1, 'intensity varies');
  assert.ok(levels.every((l) => l >= 0 && l <= 0.4 + 1e-9));
  const heavy = new Weather();
  heavy.configure({ rain: 1 }, 1);
  assert.ok(run(heavy, 120, 0.5).every((f) => f.fx[1] > 0.55));
});

test('lightning flashes, points the bolt into the sky and schedules thunder', () => {
  const w = new Weather();
  w.configure({ lightning: 1 }, 3);
  const frames = run(w, 30);
  const flashes = frames.filter((f) => f.fx[2] > 0.3);
  assert.ok(flashes.length > 0, 'at least one strong flash in 30 s');
  for (const f of flashes) {
    const [x, y, z] = f.flashDir;
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6, 'unit direction');
    assert.ok(y > 0.1 && y < 0.8, 'bolt top sits at the cloud base above the horizon');
  }
  const thunder = frames.flatMap((f) => f.events).filter((e) => e.type === 'thunder');
  assert.ok(thunder.length > 0);
  for (const t of thunder) assert.ok(t.delay > 0 && t.delay <= 7 && Math.abs(t.delay - Math.min(7, t.distance / 343)) < 1e-9);
  // flashes fade quickly
  assert.ok(frames.filter((f) => f.fx[2] > 0.05).length < frames.length * 0.2);
});

test('no weather means a calm sky', () => {
  const w = new Weather();
  w.configure({}, 1);
  for (const f of run(w, 20)) {
    assert.deepEqual(f.fx.slice(0, 3), [0, 0, 0]);
    assert.equal(f.events.length, 0);
  }
});

test('rain and storms bring low, heavy clouds', () => {
  const clear = skyForWeather({ cloudCover: 0.2 });
  const storm = skyForWeather({ cloudCover: 0.2, rain: 0.9, lightning: 0.8 });
  assert.equal(clear.cloudCover, 0.2);
  assert.ok(storm.cloudCover > 0.85);
  assert.ok(storm.cloudBase < clear.cloudBase);
  assert.ok(storm.cloudDensity > clear.cloudDensity);
});

test('the designer understands rain, storms and auroras', () => {
  const storm = designFromPrompt('a thunderstorm over a haunted graveyard').environment;
  assert.ok(storm.rain > 0.5 && storm.lightning > 0.5 && storm.particles === 'rain');
  const aurora = designFromPrompt('snowy mountains under the northern lights').environment;
  assert.ok(aurora.aurora > 0.5);
  assert.ok(aurora.timeOfDay > 20 || aurora.timeOfDay < 4, 'auroras need the night');
  const base = designFromPrompt('a sunny meadow');
  assert.equal(base.environment.rain, 0);
  const wet = refineSpec(base, 'make it rain').spec.environment;
  assert.ok(wet.rain > 0);
  const dry = refineSpec({ ...base, environment: wet }, 'stop the rain').spec.environment;
  assert.equal(dry.rain, 0);
});

test('old specs with rain particles get a steady shower', () => {
  const { spec, warnings } = normalizeSpec({ environment: { particles: 'rain' } });
  assert.equal(spec.environment.rain, 0.6);
  assert.equal(spec.environment.lightning, 0);
  assert.equal(warnings.length, 0);
});
