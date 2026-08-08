import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDurableEvidencePath,
  isHeavyProcess,
  parsePmon,
  throttleGrowth,
} from './run-playwright-hardware-gpu.mjs';

test('distinguishes conflicting renderers from unrelated background clients', () => {
  assert.equal(
    isHeavyProcess(
      'chrome-headless-shell',
      '/opt/chrome-headless-shell --use-angle=swiftshader-webgl',
    ),
    true,
  );
  assert.equal(isHeavyProcess('godot', '/usr/bin/godot --editor'), true);
  assert.equal(isHeavyProcess('godot', '/usr/bin/godot --headless -s tests.gd'), false);
  assert.equal(isHeavyProcess('qemu-system-x86', '/sdk/qemu-system-x86_64-headless @phone'), false);
  assert.equal(isHeavyProcess('node', 'node node_modules/@playwright/test/cli.js test'), true);
  assert.equal(isHeavyProcess('chrome', '/opt/google/chrome --remote-debugging-port=9222'), false);
});

test('reports only counters that increased', () => {
  assert.deepEqual(throttleGrowth({ core: 7, package: 11 }, { core: 7, package: 13 }), [
    { counterPath: 'package', before: 11, after: 13, delta: 2 },
  ]);
});

test('reads graphics and compute clients from pmon output', () => {
  const monitor = `# gpu pid type sm mem enc dec jpg ofa fb ccpm command
    0 4956 G - - - - - - 4 0 Xorg
    0 2365224 C+G 37 16 - 0 - - 1913 0 godot
`;
  assert.deepEqual(parsePmon(monitor), [
    { gpuIndex: 0, pid: 4956, processName: 'Xorg' },
    { gpuIndex: 0, pid: 2365224, processName: 'godot' },
  ]);
});

test('requires evidence outside temporary memory', () => {
  assert.equal(isDurableEvidencePath('/home/ubuntu/evidence', '/tmp'), true);
  assert.equal(isDurableEvidencePath('/tmp/run-01', '/tmp'), false);
  assert.equal(isDurableEvidencePath('/dev/shm/run-01', '/tmp'), false);
  assert.equal(isDurableEvidencePath('relative/evidence', '/tmp'), false);
});
