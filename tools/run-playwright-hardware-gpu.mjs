#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEAVY_PROCESS_NAMES = /^(chrome-headless(?:-shell)?|headless_shell)$/i;
const HEADLESS_BROWSER_EXECUTABLE =
  /(?:^|\s)(?:\S*\/)?(?:chrome-headless-shell|headless_shell)(?:\s|$)/i;
const PLAYWRIGHT_PROCESS = /(?:^|\s)(?:node|pnpm|npm|yarn).*playwright(?:\s|\/).*test(?:\s|$)/i;
const PLAYWRIGHT_BROWSER =
  /(?:chrome|chromium).*(?:--remote-debugging-pipe|playwright_chromiumdev_profile)/i;

export function isHeavyProcess(processName, commandLine) {
  return (
    HEAVY_PROCESS_NAMES.test(processName) ||
    HEADLESS_BROWSER_EXECUTABLE.test(commandLine) ||
    (/^godot/i.test(processName) && !/(?:^|\s)--headless(?:\s|$)/.test(commandLine)) ||
    PLAYWRIGHT_PROCESS.test(commandLine) ||
    PLAYWRIGHT_BROWSER.test(commandLine)
  );
}

export function throttleGrowth(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((counterPath) => {
    const previousCount = before[counterPath];
    const count = after[counterPath];
    if (previousCount === undefined || count === undefined) {
      return [{ counterPath, before: previousCount ?? null, after: count ?? null, delta: null }];
    }
    if (count <= previousCount) return [];
    return [{ counterPath, before: previousCount, after: count, delta: count - previousCount }];
  });
}

export function parsePmon(processMonitor) {
  return processMonitor
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 3 && Number.isInteger(Number(fields[1])))
    .map((fields) => ({
      gpuIndex: Number(fields[0]),
      pid: Number(fields[1]),
      processName: fields.at(-1),
    }));
}

export function isDurableEvidencePath(evidenceDirectory, temporaryDirectory = os.tmpdir()) {
  const resolved = path.resolve(evidenceDirectory);
  const temporaryRoots = [path.resolve(temporaryDirectory), '/dev/shm'];
  return (
    path.isAbsolute(evidenceDirectory) &&
    temporaryRoots.every(
      (temporaryRoot) =>
        resolved !== temporaryRoot && !resolved.startsWith(`${temporaryRoot}${path.sep}`),
    )
  );
}

function parsePositiveInteger(rawValue, label, fallback) {
  const value = rawValue === undefined ? fallback : Number(rawValue);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer`);
  return value;
}

function commandResult(command, args, environment = process.env) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function processRecord(pid) {
  try {
    const processName = readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
    const commandLine = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const parentMatch = stat.match(/^\d+ \(.+\) \S (\d+) /);
    if (!parentMatch) return null;
    return { pid, parentPid: Number(parentMatch[1]), processName, commandLine };
  } catch {
    return null;
  }
}

function processTable() {
  return readdirSync('/proc', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => processRecord(Number(entry.name)))
    .filter(Boolean);
}

function isDescendant(pid, ancestorPid, recordsByPid) {
  const visited = new Set();
  let currentPid = pid;
  while (currentPid > 1 && !visited.has(currentPid)) {
    if (currentPid === ancestorPid) return true;
    visited.add(currentPid);
    currentPid =
      recordsByPid.get(currentPid)?.parentPid ?? processRecord(currentPid)?.parentPid ?? 0;
  }
  return false;
}

function inspectProcesses(allowedRootPid) {
  const records = processTable();
  const recordsByPid = new Map(records.map((record) => [record.pid, record]));
  const foreignHeavyProcesses = records.filter(
    (record) =>
      isHeavyProcess(record.processName, record.commandLine) &&
      (!allowedRootPid || !isDescendant(record.pid, allowedRootPid, recordsByPid)) &&
      record.pid !== process.pid,
  );
  const browserProcesses = allowedRootPid
    ? records.filter(
        (record) =>
          isDescendant(record.pid, allowedRootPid, recordsByPid) &&
          /(?:chrome|chromium|headless_shell)/i.test(`${record.processName} ${record.commandLine}`),
      )
    : [];
  return { foreignHeavyProcesses, browserProcesses };
}

function thermalThrottleSnapshot() {
  const snapshot = {};
  const cpuDirectories = readdirSync('/sys/devices/system/cpu', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^cpu\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(left.slice(3)) - Number(right.slice(3)));

  for (const cpuDirectory of cpuDirectories) {
    for (const counterName of ['core_throttle_count', 'package_throttle_count']) {
      const counterPath = `/sys/devices/system/cpu/${cpuDirectory}/thermal_throttle/${counterName}`;
      if (existsSync(counterPath))
        snapshot[counterPath] = Number(readFileSync(counterPath, 'utf8').trim());
    }
  }
  if (Object.keys(snapshot).length === 0)
    throw new Error('No CPU thermal throttle counters were found');
  return snapshot;
}

function cpuPackageTemperature() {
  const sensors = commandResult('sensors', ['-u', 'coretemp-isa-0000']);
  if (sensors.status !== 0)
    throw new Error(`Unable to read CPU temperature: ${sensors.stderr.trim()}`);
  const packageBlock = sensors.stdout.match(/Package id 0:\s*[\s\S]*?temp1_input:\s*([\d.]+)/);
  if (!packageBlock) throw new Error('CPU package temperature was absent from sensors output');
  return Number(packageBlock[1]);
}

function gpuStatus(gpuUuid) {
  const query = [
    'uuid',
    'name',
    'pci.bus_id',
    'temperature.gpu',
    'utilization.gpu',
    'power.draw',
    'clocks_throttle_reasons.hw_thermal_slowdown',
    'clocks_throttle_reasons.sw_thermal_slowdown',
    'clocks_throttle_reasons.hw_power_brake_slowdown',
  ].join(',');
  const gpu = commandResult('nvidia-smi', [
    '-i',
    gpuUuid,
    `--query-gpu=${query}`,
    '--format=csv,noheader,nounits',
  ]);
  if (gpu.status !== 0) throw new Error(`Unable to read selected GPU: ${gpu.stderr.trim()}`);
  const fields = gpu.stdout
    .trim()
    .split(',')
    .map((field) => field.trim());
  if (fields.length !== 9 || fields[0] !== gpuUuid)
    throw new Error('Selected GPU status was incomplete');
  return {
    uuid: fields[0],
    name: fields[1],
    busId: fields[2],
    temperatureC: Number(fields[3]),
    utilizationPercent: Number(fields[4]),
    powerWatts: Number(fields[5]),
    hardwareThermalSlowdown: fields[6],
    softwareThermalSlowdown: fields[7],
    hardwarePowerBrakeSlowdown: fields[8],
  };
}

function gpuComputeProcesses() {
  const compute = commandResult('nvidia-smi', [
    '--query-compute-apps=gpu_uuid,pid,process_name',
    '--format=csv,noheader,nounits',
  ]);
  if (compute.status !== 0)
    throw new Error(`Unable to inspect GPU clients: ${compute.stderr.trim()}`);
  return compute.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [gpuUuid, pid, ...processName] = line.split(',').map((field) => field.trim());
      return { gpuUuid, pid: Number(pid), processName: processName.join(', ') };
    });
}

function gpuProcessMonitor(gpuUuid) {
  const monitor = commandResult('nvidia-smi', ['pmon', '-c', '1', '-s', 'um', '-i', gpuUuid]);
  if (monitor.status !== 0)
    throw new Error(`Unable to inspect selected GPU processes: ${monitor.stderr.trim()}`);
  return monitor.stdout;
}

function gpuSlowdownActive(gpu) {
  return [
    gpu.hardwareThermalSlowdown,
    gpu.softwareThermalSlowdown,
    gpu.hardwarePowerBrakeSlowdown,
  ].some((state) => state !== 'Not Active');
}

function writeJson(filePath, contents) {
  writeFileSync(filePath, `${JSON.stringify(contents, null, 2)}\n`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stopProcessGroup(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const forceStop = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 10_000);
  forceStop.unref();
}

async function run() {
  if (process.platform !== 'linux')
    throw new Error('Hardware GPU validation currently supports Linux only');

  const evidenceDirectory = process.env.PLAYWRIGHT_HARDWARE_EVIDENCE_DIR;
  const browserStateDirectory = process.env.PLAYWRIGHT_HARDWARE_STATE_DIR;
  const gpuUuid = process.env.PLAYWRIGHT_GPU_UUID;
  const display = process.env.DISPLAY;
  const provider = process.env.PLAYWRIGHT_NVIDIA_PROVIDER;
  const resourceController = process.env.PLAYWRIGHT_RESOURCE_CTL ?? 'agentctl';
  const agentLane = process.env.AGENT_LANE ?? 'spellcross';
  const leaseResource = process.env.PLAYWRIGHT_GPU_RESOURCE ?? 'gpu-t4';
  const leaseSeconds = parsePositiveInteger(
    process.env.PLAYWRIGHT_GPU_LEASE_SECONDS,
    'PLAYWRIGHT_GPU_LEASE_SECONDS',
    1800,
  );
  const sampleInterval = parsePositiveInteger(
    process.env.PLAYWRIGHT_HARDWARE_SAMPLE_MS,
    'PLAYWRIGHT_HARDWARE_SAMPLE_MS',
    2000,
  );
  const maximumCpuTemperature = parsePositiveInteger(
    process.env.PLAYWRIGHT_MAX_CPU_TEMP_C,
    'PLAYWRIGHT_MAX_CPU_TEMP_C',
    90,
  );
  const maximumGpuTemperature = parsePositiveInteger(
    process.env.PLAYWRIGHT_MAX_GPU_TEMP_C,
    'PLAYWRIGHT_MAX_GPU_TEMP_C',
    85,
  );
  const maximumLoadOneMinute = parsePositiveInteger(
    process.env.PLAYWRIGHT_MAX_LOAD_1M,
    'PLAYWRIGHT_MAX_LOAD_1M',
    Math.ceil(os.cpus().length / 2),
  );

  if (!evidenceDirectory || !isDurableEvidencePath(evidenceDirectory)) {
    throw new Error(
      'PLAYWRIGHT_HARDWARE_EVIDENCE_DIR must be an absolute persistent path outside temporary memory',
    );
  }
  if (!browserStateDirectory || !isDurableEvidencePath(browserStateDirectory)) {
    throw new Error(
      'PLAYWRIGHT_HARDWARE_STATE_DIR must be an absolute persistent path outside temporary memory',
    );
  }
  if (path.resolve(browserStateDirectory).length > 60) {
    throw new Error('PLAYWRIGHT_HARDWARE_STATE_DIR is too long for Chromium IPC sockets');
  }
  if (!gpuUuid) throw new Error('PLAYWRIGHT_GPU_UUID is required');
  if (!display) throw new Error('DISPLAY is required');
  if (!provider) throw new Error('PLAYWRIGHT_NVIDIA_PROVIDER is required');
  if (process.env.PLAYWRIGHT_BASE_URL) {
    throw new Error('Hardware GPU validation must own its local web server');
  }
  if (existsSync(evidenceDirectory) && readdirSync(evidenceDirectory).length > 0) {
    throw new Error(`Evidence directory is not empty: ${evidenceDirectory}`);
  }
  if (existsSync(browserStateDirectory) && readdirSync(browserStateDirectory).length > 0) {
    throw new Error(`Browser state directory is not empty: ${browserStateDirectory}`);
  }

  mkdirSync(evidenceDirectory, { recursive: true });
  const durableEvidenceDirectory = realpathSync(evidenceDirectory);
  if (!isDurableEvidencePath(durableEvidenceDirectory)) {
    throw new Error('PLAYWRIGHT_HARDWARE_EVIDENCE_DIR resolves into temporary memory');
  }
  const testArguments = process.argv
    .slice(2)
    .filter((argument, index) => argument !== '--' || index !== 0);
  mkdirSync(browserStateDirectory, { recursive: true });
  const durableBrowserStateDirectory = realpathSync(browserStateDirectory);
  if (!isDurableEvidencePath(durableBrowserStateDirectory)) {
    throw new Error('PLAYWRIGHT_HARDWARE_STATE_DIR resolves into temporary memory');
  }
  const runEnvironment = {
    ...process.env,
    AGENT_LANE: agentLane,
    PLAYWRIGHT_HARDWARE_GPU: '1',
    PLAYWRIGHT_HARDWARE_RUNNER: '1',
    PLAYWRIGHT_HARDWARE_EVIDENCE_DIR: durableEvidenceDirectory,
    TMPDIR: durableBrowserStateDirectory,
    __NV_PRIME_RENDER_OFFLOAD: '1',
    __GLX_VENDOR_LIBRARY_NAME: 'nvidia',
    __NV_PRIME_RENDER_OFFLOAD_PROVIDER: provider,
  };
  const metadata = {
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    display,
    provider,
    gpuUuid,
    browserStateDirectory: durableBrowserStateDirectory,
    leaseResource,
    leaseSeconds,
    workers: 1,
    maximumCpuTemperature,
    maximumGpuTemperature,
    maximumLoadOneMinute,
    playwrightArguments: testArguments,
  };
  writeJson(path.join(durableEvidenceDirectory, 'run-metadata.json'), metadata);

  let leaseHeld = false;
  let leaseExpiresAt = null;
  let leaseRenewalCount = 0;
  let nextLeaseRenewalAt = null;
  let child;
  let childFinished;
  let playwrightLog;
  let playwrightLogClosed = false;
  let testExitCode = null;
  const violations = [];
  let selectedGpuBrowserObserved = false;
  let throttleBefore;
  let throttleAfter;
  let maximumObservedCpuTemperature = null;
  let maximumObservedGpuTemperature = null;
  let sampleCount = 0;
  const stopForSignal = (signal) => {
    if (!violations.some((violation) => violation.type === 'runner-signal')) {
      violations.push({ type: 'runner-signal', signal });
    }
    stopProcessGroup(child);
  };
  const signalHandlers = new Map(
    ['SIGHUP', 'SIGINT', 'SIGTERM'].map((signal) => [signal, () => stopForSignal(signal)]),
  );
  for (const [signal, handler] of signalHandlers) process.once(signal, handler);

  try {
    const lease = commandResult(
      resourceController,
      ['lease', '--resource', leaseResource, '--seconds', String(leaseSeconds)],
      runEnvironment,
    );
    writeFileSync(
      path.join(durableEvidenceDirectory, 'lease-acquire.log'),
      `${lease.stdout}${lease.stderr}`,
    );
    if (lease.status !== 0) throw new Error(`Could not acquire ${leaseResource} lease`);
    leaseHeld = true;
    const leaseResponse = JSON.parse(lease.stdout);
    leaseExpiresAt = Number(leaseResponse.expiresAt);
    if (leaseResponse.acquired !== true || !Number.isFinite(leaseExpiresAt)) {
      throw new Error(`${leaseResource} lease response was incomplete`);
    }
    nextLeaseRenewalAt = Date.now() + Math.max(1_000, Math.floor((leaseSeconds * 1_000) / 2));

    const preflightProcesses = inspectProcesses();
    writeJson(path.join(durableEvidenceDirectory, 'preflight-processes.json'), preflightProcesses);
    if (preflightProcesses.foreignHeavyProcesses.length > 0) {
      throw new Error(
        `Conflicting heavy processes are active: ${preflightProcesses.foreignHeavyProcesses
          .map((record) => `${record.pid}:${record.processName}`)
          .join(', ')}`,
      );
    }

    const preflightCompute = gpuComputeProcesses();
    writeJson(
      path.join(durableEvidenceDirectory, 'preflight-gpu-compute-processes.json'),
      preflightCompute,
    );
    const selectedGpuClients = preflightCompute.filter((client) => client.gpuUuid === gpuUuid);
    if (selectedGpuClients.length > 0) {
      throw new Error(
        `Selected GPU has active compute clients: ${selectedGpuClients
          .map((client) => `${client.pid}:${client.processName}`)
          .join(', ')}`,
      );
    }

    const preflightGpuProcesses = parsePmon(gpuProcessMonitor(gpuUuid));
    const foreignGraphicsClients = preflightGpuProcesses.filter(
      (client) => client.processName !== 'Xorg',
    );
    if (foreignGraphicsClients.length > 0) {
      throw new Error(
        `Selected GPU has active graphics clients: ${foreignGraphicsClients
          .map((client) => `${client.pid}:${client.processName}`)
          .join(', ')}`,
      );
    }

    const providerList = commandResult('xrandr', ['--display', display, '--listproviders']);
    writeFileSync(
      path.join(durableEvidenceDirectory, 'xrandr-providers.log'),
      `${providerList.stdout}${providerList.stderr}`,
    );
    if (providerList.status !== 0 || !providerList.stdout.includes(`name:${provider}`)) {
      throw new Error(`X11 provider ${provider} is unavailable on ${display}`);
    }

    throttleBefore = thermalThrottleSnapshot();
    writeJson(path.join(durableEvidenceDirectory, 'throttle-before.json'), throttleBefore);
    const preflightCpuTemperature = cpuPackageTemperature();
    const preflightGpu = gpuStatus(gpuUuid);
    const preflightLoadAverage = os.loadavg();
    maximumObservedCpuTemperature = preflightCpuTemperature;
    maximumObservedGpuTemperature = preflightGpu.temperatureC;
    writeJson(path.join(durableEvidenceDirectory, 'host-preflight.json'), {
      capturedAt: new Date().toISOString(),
      loadAverage: preflightLoadAverage,
      cpuTemperatureC: preflightCpuTemperature,
      gpu: preflightGpu,
      gpuProcesses: preflightGpuProcesses,
    });
    if (preflightCpuTemperature > maximumCpuTemperature) {
      throw new Error(`CPU package temperature is already ${preflightCpuTemperature} C`);
    }
    if (preflightLoadAverage[0] > maximumLoadOneMinute) {
      throw new Error(`One-minute load average is already ${preflightLoadAverage[0].toFixed(2)}`);
    }
    if (preflightGpu.temperatureC > maximumGpuTemperature) {
      throw new Error(`Selected GPU temperature is already ${preflightGpu.temperatureC} C`);
    }
    if (gpuSlowdownActive(preflightGpu)) {
      throw new Error('Selected GPU reports an active slowdown state');
    }

    playwrightLog = createWriteStream(path.join(durableEvidenceDirectory, 'playwright.log'), {
      flags: 'wx',
    });
    child = spawn('pnpm', ['exec', 'playwright', 'test', ...testArguments], {
      cwd: process.cwd(),
      detached: true,
      env: runEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      playwrightLog.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      playwrightLog.write(chunk);
    });

    childFinished = new Promise((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
      child.on('error', (error) => resolve({ code: null, signal: null, error: error.message }));
    });
    let completion;
    let terminating = false;

    while (!completion) {
      const race = await Promise.race([
        childFinished.then((finished) => ({ finished })),
        delay(sampleInterval).then(() => ({ tick: true })),
      ]);
      if (race.finished) {
        completion = race.finished;
        break;
      }

      const processInspection = inspectProcesses(child.pid);
      let leaseRenewalViolation = null;
      if (Date.now() >= nextLeaseRenewalAt) {
        const renewal = commandResult(
          resourceController,
          ['lease', '--resource', leaseResource, '--seconds', String(leaseSeconds)],
          runEnvironment,
        );
        let renewalResponse = null;
        try {
          renewalResponse = JSON.parse(renewal.stdout);
        } catch {
          // The structured failure below preserves the raw response for diagnosis.
        }
        appendFileSync(
          path.join(durableEvidenceDirectory, 'lease-renewals.jsonl'),
          `${JSON.stringify({
            capturedAt: new Date().toISOString(),
            status: renewal.status,
            response: renewalResponse,
            stderr: renewal.stderr.trim(),
          })}\n`,
        );
        const renewedUntil = Number(renewalResponse?.expiresAt);
        if (
          renewal.status !== 0 ||
          renewalResponse?.acquired !== true ||
          !Number.isFinite(renewedUntil) ||
          renewedUntil <= Date.now()
        ) {
          leaseRenewalViolation = {
            type: 'lease-renewal',
            exitCode: renewal.status,
            response: renewalResponse,
            stderr: renewal.stderr.trim(),
          };
        } else {
          leaseExpiresAt = renewedUntil;
          leaseRenewalCount += 1;
          nextLeaseRenewalAt = Date.now() + Math.max(1_000, Math.floor((leaseSeconds * 1_000) / 2));
        }
      }
      const throttleCurrent = thermalThrottleSnapshot();
      const cpuTemperatureC = cpuPackageTemperature();
      const gpu = gpuStatus(gpuUuid);
      const computeProcesses = gpuComputeProcesses();
      const pmon = gpuProcessMonitor(gpuUuid);
      const descendantPids = new Set(
        processInspection.browserProcesses.map((record) => record.pid),
      );
      const gpuProcesses = parsePmon(pmon);
      if (gpuProcesses.some((client) => descendantPids.has(client.pid))) {
        selectedGpuBrowserObserved = true;
      }
      maximumObservedCpuTemperature = Math.max(maximumObservedCpuTemperature, cpuTemperatureC);
      maximumObservedGpuTemperature = Math.max(maximumObservedGpuTemperature, gpu.temperatureC);
      sampleCount += 1;

      const sampleViolations = [];
      if (leaseRenewalViolation) sampleViolations.push(leaseRenewalViolation);
      const loadAverage = os.loadavg();
      const counterGrowth = throttleGrowth(throttleBefore, throttleCurrent);
      if (counterGrowth.length > 0)
        sampleViolations.push({ type: 'cpu-throttle-growth', counters: counterGrowth });
      if (cpuTemperatureC > maximumCpuTemperature) {
        sampleViolations.push({
          type: 'cpu-temperature',
          observed: cpuTemperatureC,
          limit: maximumCpuTemperature,
        });
      }
      if (loadAverage[0] > maximumLoadOneMinute) {
        sampleViolations.push({
          type: 'host-load',
          observed: loadAverage[0],
          limit: maximumLoadOneMinute,
        });
      }
      if (gpu.temperatureC > maximumGpuTemperature) {
        sampleViolations.push({
          type: 'gpu-temperature',
          observed: gpu.temperatureC,
          limit: maximumGpuTemperature,
        });
      }
      if (gpuSlowdownActive(gpu)) {
        sampleViolations.push({ type: 'gpu-slowdown', gpu });
      }
      if (processInspection.foreignHeavyProcesses.length > 0) {
        sampleViolations.push({
          type: 'foreign-heavy-process',
          processes: processInspection.foreignHeavyProcesses,
        });
      }
      const foreignSelectedGpuClients = computeProcesses.filter(
        (client) => client.gpuUuid === gpuUuid && !isDescendant(client.pid, child.pid, new Map()),
      );
      if (foreignSelectedGpuClients.length > 0) {
        sampleViolations.push({
          type: 'foreign-selected-gpu-client',
          clients: foreignSelectedGpuClients,
        });
      }
      const foreignSelectedGpuGraphics = gpuProcesses.filter(
        (client) => client.processName !== 'Xorg' && !descendantPids.has(client.pid),
      );
      if (foreignSelectedGpuGraphics.length > 0) {
        sampleViolations.push({
          type: 'foreign-selected-gpu-graphics',
          clients: foreignSelectedGpuGraphics,
        });
      }
      const swiftShaderProcesses = processInspection.browserProcesses.filter((record) =>
        /SwiftShader/i.test(record.commandLine),
      );
      if (swiftShaderProcesses.length > 0) {
        sampleViolations.push({ type: 'swiftshader-process', processes: swiftShaderProcesses });
      }

      const sample = {
        capturedAt: new Date().toISOString(),
        loadAverage,
        cpuTemperatureC,
        gpu,
        gpuProcesses,
        browserProcesses: processInspection.browserProcesses,
        violations: sampleViolations,
      };
      appendFileSync(
        path.join(durableEvidenceDirectory, 'hardware-samples.jsonl'),
        `${JSON.stringify(sample)}\n`,
      );
      process.stdout.write(
        `[hardware] CPU ${cpuTemperatureC.toFixed(1)} C, GPU ${gpu.temperatureC} C, ${gpu.utilizationPercent}%\n`,
      );
      if (sampleViolations.length > 0 && !terminating) {
        violations.push(...sampleViolations);
        terminating = true;
        stopProcessGroup(child);
      }
    }

    testExitCode = completion?.code ?? 1;
    if (completion?.signal)
      violations.push({ type: 'playwright-signal', signal: completion.signal });
    if (completion?.error) violations.push({ type: 'playwright-spawn', message: completion.error });
    await new Promise((resolve) => playwrightLog.end(resolve));
    playwrightLogClosed = true;

    throttleAfter = thermalThrottleSnapshot();
    writeJson(path.join(durableEvidenceDirectory, 'throttle-after.json'), throttleAfter);
    const postflightCpuTemperature = cpuPackageTemperature();
    const postflightGpu = gpuStatus(gpuUuid);
    maximumObservedCpuTemperature = Math.max(
      maximumObservedCpuTemperature,
      postflightCpuTemperature,
    );
    maximumObservedGpuTemperature = Math.max(
      maximumObservedGpuTemperature,
      postflightGpu.temperatureC,
    );
    writeJson(path.join(durableEvidenceDirectory, 'host-postflight.json'), {
      capturedAt: new Date().toISOString(),
      loadAverage: os.loadavg(),
      cpuTemperatureC: postflightCpuTemperature,
      gpu: postflightGpu,
      gpuProcesses: parsePmon(gpuProcessMonitor(gpuUuid)),
    });
    const finalGrowth = throttleGrowth(throttleBefore, throttleAfter);
    if (
      finalGrowth.length > 0 &&
      !violations.some((violation) => violation.type === 'cpu-throttle-growth')
    ) {
      violations.push({ type: 'cpu-throttle-growth', counters: finalGrowth });
    }

    const rendererProofPath = path.join(durableEvidenceDirectory, 'renderer-proof.json');
    if (!existsSync(rendererProofPath)) {
      violations.push({ type: 'renderer-proof-missing' });
    } else {
      const rendererProof = JSON.parse(readFileSync(rendererProofPath, 'utf8'));
      if (!/NVIDIA/i.test(rendererProof.renderer) || /SwiftShader/i.test(rendererProof.renderer)) {
        violations.push({ type: 'renderer-proof-invalid', renderer: rendererProof.renderer });
      }
    }
    if (!selectedGpuBrowserObserved) violations.push({ type: 'selected-gpu-browser-not-observed' });
    if (testExitCode !== 0) violations.push({ type: 'playwright-exit', exitCode: testExitCode });
  } catch (error) {
    violations.push({
      type: 'runner-error',
      message: error instanceof Error ? error.message : String(error),
    });
    stopProcessGroup(child);
    if (childFinished) {
      const stopped = await Promise.race([
        childFinished,
        delay(15_000).then(() => ({ code: null, signal: 'STOP_TIMEOUT' })),
      ]);
      testExitCode = stopped.code ?? 1;
    }
    if (playwrightLog && !playwrightLogClosed) {
      await new Promise((resolve) => playwrightLog.end(resolve));
      playwrightLogClosed = true;
    }
  } finally {
    if (leaseHeld) {
      const release = commandResult(
        resourceController,
        ['release', '--resource', leaseResource],
        runEnvironment,
      );
      writeFileSync(
        path.join(durableEvidenceDirectory, 'lease-release.log'),
        `${release.stdout}${release.stderr}`,
      );
      if (release.status !== 0)
        violations.push({ type: 'lease-release', exitCode: release.status });
    }
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  }

  const result = {
    ...metadata,
    finishedAt: new Date().toISOString(),
    testExitCode,
    selectedGpuBrowserObserved,
    leaseExpiresAt,
    leaseRenewalCount,
    sampleCount,
    maximumObservedCpuTemperature,
    maximumObservedGpuTemperature,
    throttleGrowth:
      throttleBefore && throttleAfter ? throttleGrowth(throttleBefore, throttleAfter) : null,
    violations,
    passed: violations.length === 0,
  };
  writeJson(path.join(durableEvidenceDirectory, 'result.json'), result);
  if (!result.passed)
    throw new Error(
      `Hardware GPU validation failed; see ${path.join(durableEvidenceDirectory, 'result.json')}`,
    );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
