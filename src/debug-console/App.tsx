import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Brain,
  Cable,
  ChevronDown,
  CircleAlert,
  CircleOff,
  Download,
  Gauge,
  LineChart,
  LoaderCircle,
  Radio,
  Rows3,
  Unplug,
} from "lucide-react";
import {
  HeadsetFitPanel,
  type FitCheckState,
} from "./components/quality/HeadsetFitPanel";
import { AffectiveStatePanel } from "./components/AffectiveStatePanel";
import { BandPowerMonitorPanel } from "./components/BandPowerMonitorPanel";
import { LiveEegPlot } from "./components/LiveEegPlot";
import { MetricMonitorPanel, type MetricKey } from "./components/MetricMonitorPanel";
import { ProtocolsPanel } from "./components/ProtocolsPanel";
import { PlotSeriesSelector } from "./components/PlotSeriesSelector";
import {
  type DeviceInfo,
  type EegConnectionState,
  type EegFrameSummary,
  type SignalFrame,
  getCapability,
  summarizeEegFrame,
} from "./domain/eeg";
import type { EegProvider } from "./providers/eegProvider";
import {
  createEegProvider,
  deviceCatalog,
  getConfiguredProviderKey,
} from "./providers/providerRegistry";
import { defaultHeadsetFitThresholds } from "./signalQuality/headsetFitConfig";
import { eegEngine } from "../services/eegEngine";
import { getDefaultProtocolThreshold, protocolDefinitions } from "../services/protocols";
import type { ProtocolType } from "../types";
import {
  createInitialSnapshot,
  frameAgeMs,
  HeuristicHeadsetFitProvider,
  type HeadsetFitSnapshot,
} from "./signalQuality/headsetFitProvider";
import {
  AffectiveStateProvider,
  type AffectiveCalibrationState,
  type AffectiveStateSample,
} from "./metrics/affectiveStateMetric";

const maxHistorySamples = 640;
const fitCheckDurationMs = 3500;
const streamStaleMs = 2000;
function formatValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toFixed(2);
}

function statusClassName(state: EegConnectionState) {
  if (state === "streaming" || state === "connected") return "connection-state is-live";
  if (state === "error") return "connection-state is-error";
  if (state === "connecting" || state === "initializing") {
    return "connection-state is-busy";
  }
  return "connection-state";
}

function StatusIcon({ state }: { state: EegConnectionState }) {
  if (state === "streaming" || state === "connected") {
    return <Radio aria-hidden="true" />;
  }

  if (state === "error") {
    return <CircleAlert aria-hidden="true" />;
  }

  if (state === "connecting" || state === "initializing") {
    return <LoaderCircle aria-hidden="true" className="spin" />;
  }

  return <CircleOff aria-hidden="true" />;
}

export default function App() {
  const providerRef = useRef<EegProvider | null>(null);
  const fitProviderRef = useRef(new HeuristicHeadsetFitProvider());
  const affectiveProviderRef = useRef(new AffectiveStateProvider());
  const recordingFramesRef = useRef<SignalFrame[]>([]);
  const recordingActiveRef = useRef(false);
  const fitSnapshotRef = useRef<HeadsetFitSnapshot | null>(null);
  const fitCheckTimeoutRef = useRef<number | null>(null);
  const lastFrameArrivedAtRef = useRef<number | null>(null);
  const sampleCountRef = useRef(0);
  const frameCountRef = useRef(0);
  const calibrationStatusRef = useRef<AffectiveCalibrationState["status"]>("off");
  const [state, setState] = useState<EegConnectionState>("idle");
  const [statusDetail, setStatusDetail] = useState("");
  const [error, setError] = useState("");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [sampleCount, setSampleCount] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [plotHistory, setPlotHistory] = useState<Record<string, number[]>>({});
  const [bandHistory, setBandHistory] = useState<Record<string, number[]>>({});
  const [latestBands, setLatestBands] = useState<Record<string, number>>({});
  const [metricHistory, setMetricHistory] = useState<Record<string, number[]>>({});
  const [baselineMetricHistory, setBaselineMetricHistory] = useState<Record<string, number[]>>({});
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("mindfulness");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [providerLabel, setProviderLabel] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("brainflow-muse-athena");
  const [latestFrame, setLatestFrame] = useState<SignalFrame | null>(null);
  const [affectiveState, setAffectiveState] = useState<AffectiveStateSample | null>(null);
  const [affectiveCalibration, setAffectiveCalibration] =
    useState<AffectiveCalibrationState>(() =>
      affectiveProviderRef.current.getCalibrationState(),
    );
  const [recording, setRecording] = useState(false);
  const [recordedFrameCount, setRecordedFrameCount] = useState(0);
  const [fitSnapshot, setFitSnapshot] = useState<HeadsetFitSnapshot>(() =>
    fitProviderRef.current.update({
      connectionState: "idle",
      deviceInfo: null,
      frame: null,
    }),
  );
  const [fitCheck, setFitCheck] = useState<FitCheckState>({
    status: "idle",
    startedAtMs: null,
    completedAtMs: null,
    result: null,
  });
  const [protocol, setProtocol] = useState<ProtocolType>(() => eegEngine.getProtocol());
  const [threshold, setThreshold] = useState(() => String(eegEngine.getThreshold()));

  const eegCapability = useMemo(
    () => getCapability(deviceInfo, "eeg"),
    [deviceInfo],
  );
  const selectedDevice = useMemo(() => {
    return (
      deviceCatalog.find((device) => device.id === selectedDeviceId) ??
      deviceCatalog[0]
    );
  }, [selectedDeviceId]);
  // Both real connection options are adapters over Neurasticity's EEGEngine,
  // whose BrainFlow and Bluetooth paths each receive headset-fit results from
  // brainflow_service. Only the mock provider needs the client heuristic.
  const usesServerFit =
    (selectedDevice.providerKey ?? getConfiguredProviderKey()) !== "mock";
  const channelNames = useMemo(() => {
    return eegCapability?.channels.length
      ? eegCapability.channels.map((channel) => channel.label)
      : Object.keys(latest);
  }, [eegCapability, latest]);
  const plottedChannels = selectedChannels.filter((name) => channelNames.includes(name));

  useEffect(() => {
    setSelectedChannels((current) => {
      const available = current.filter((name) => channelNames.includes(name));
      return available.length || channelNames.length === 0 ? available : [channelNames[0]];
    });
  }, [channelNames]);

  useEffect(() => {
    const providerKey = selectedDevice.providerKey ?? getConfiguredProviderKey();
    const provider = createEegProvider(providerKey, {
      onState: (nextState, detail) => {
        setState(nextState);
        setStatusDetail(detail ?? "");
        if (nextState === "disconnected" || nextState === "error") {
          recordingActiveRef.current = false;
          setRecording(false);
        }
      },
      onDeviceInfo: (info) => setDeviceInfo(info),
      onSignalFrame: (frame) => {
        if (frame.sensor !== "eeg") return;

        lastFrameArrivedAtRef.current = performance.now();
        setLatestFrame(frame);
        const nextAffective = affectiveProviderRef.current.pushFrame(frame, fitSnapshotRef.current);
        setAffectiveState(nextAffective);
        const calibration = calibrationStateFromFrame(frame) ?? affectiveProviderRef.current.getCalibrationState();
        if (calibrationStatusRef.current !== calibration.status) setMetricHistory({});
        calibrationStatusRef.current = calibration.status;
        setAffectiveCalibration(calibration);
        if (recordingActiveRef.current) {
          recordingFramesRef.current.push(frame);
          setRecordedFrameCount(recordingFramesRef.current.length);
        }
        const summary: EegFrameSummary = summarizeEegFrame(
          frame,
          sampleCountRef.current,
          frameCountRef.current,
        );

        sampleCountRef.current = summary.totalSamples;
        frameCountRef.current = summary.frameCount;
        setLatest(summary.latestByChannel);
        setSampleCount(summary.totalSamples);
        setFrameCount(summary.frameCount);

        setPlotHistory((current) => {
          const next = { ...current };
          for (const [name, value] of Object.entries(summary.latestByChannel)) {
            next[name] = [...(next[name] ?? []), value].slice(-maxHistorySamples);
          }
          return next;
        });
        const bands = frame.features?.bandPowers?.absolute;
        if (bands) {
          setLatestBands(bands);
          setBandHistory((current) => appendHistory(current, bands));
        }
        setMetricHistory((current) => appendHistory(current, metricValuesFromService(frame.features?.rawMetrics ?? {})));
        setBaselineMetricHistory((current) => appendHistory(current, metricValuesFromService(frame.features?.baselineRelativeMetrics ?? {})));
      },
      onError: (providerError) => {
        setError(
          providerError.code
            ? `${providerError.message} (${providerError.code})`
            : providerError.message,
        );
      },
    });

    providerRef.current = provider;
    // Bluetooth's fit assessment is computed entirely server-side (see
    // `snapshotFromServerFit`) -- this client heuristic is only used for
    // providers that don't supply one (BrainFlow, replay, mock).
    fitProviderRef.current.reset();
    affectiveProviderRef.current.reset();
    setAffectiveCalibration(affectiveProviderRef.current.getCalibrationState());
    if (fitCheckTimeoutRef.current !== null) {
      window.clearTimeout(fitCheckTimeoutRef.current);
      fitCheckTimeoutRef.current = null;
    }
    setProviderLabel(provider.descriptor.label);
    setState("idle");
    setStatusDetail("");
    setError("");
    setDeviceInfo(null);
    setLatest({});
    setSampleCount(0);
    setFrameCount(0);
    setPlotHistory({});
    setBandHistory({});
    setLatestBands({});
    setMetricHistory({});
    setBaselineMetricHistory({});
    setLatestFrame(null);
    setAffectiveState(null);
    lastFrameArrivedAtRef.current = null;
    setRecording(false);
    recordingActiveRef.current = false;
    setRecordedFrameCount(0);
    recordingFramesRef.current = [];
    const initialFit = computeFitSnapshot(fitProviderRef.current, usesServerFit, {
        connectionState: "idle",
        deviceInfo: null,
        frame: null,
    });
    fitSnapshotRef.current = initialFit;
    setFitSnapshot(initialFit);
    setFitCheck({
      status: "idle",
      startedAtMs: null,
      completedAtMs: null,
      result: null,
    });
    sampleCountRef.current = 0;
    frameCountRef.current = 0;

    return () => {
      if (fitCheckTimeoutRef.current !== null) {
        window.clearTimeout(fitCheckTimeoutRef.current);
        fitCheckTimeoutRef.current = null;
      }
      void provider.disconnect();
      providerRef.current = null;
    };
  }, [selectedDevice]);

  const busy =
    state === "initializing" ||
    state === "connecting" ||
    state === "disconnecting";
  const connected = state === "connected" || state === "streaming";

  function clearCurrentSignal() {
    setLatest({});
    setPlotHistory({});
    setLatestFrame(null);
    setAffectiveState(null);
    affectiveProviderRef.current.reset();
    setAffectiveCalibration(affectiveProviderRef.current.getCalibrationState());
    lastFrameArrivedAtRef.current = null;
  }

  function changeProtocol(nextProtocol: ProtocolType) {
    eegEngine.setProtocol(nextProtocol);
    setProtocol(nextProtocol);
    setThreshold(String(eegEngine.getThreshold()));
  }

  function changeThreshold(nextThreshold: string) {
    setThreshold(nextThreshold);
    const numericThreshold = Number(nextThreshold);
    if (nextThreshold.trim() !== '' && Number.isFinite(numericThreshold)) {
      eegEngine.setThreshold(numericThreshold);
    }
  }

  function resetProtocolThreshold() {
    const defaultThreshold = getDefaultProtocolThreshold(protocol);
    eegEngine.setThreshold(defaultThreshold);
    setThreshold(String(defaultThreshold));
  }

  useEffect(() => {
    const updateFit = () => {
      const nextFit = computeFitSnapshot(fitProviderRef.current, usesServerFit, {
        connectionState: state,
        deviceInfo,
        frame: latestFrame,
      });
      fitSnapshotRef.current = nextFit;
      setFitSnapshot(nextFit);
    };

    updateFit();
    const intervalId = window.setInterval(updateFit, 500);

    return () => window.clearInterval(intervalId);
  }, [deviceInfo, latestFrame, state, usesServerFit]);

  useEffect(() => {
    if (!connected) return;

    const intervalId = window.setInterval(() => {
      const lastFrameArrivedAt = lastFrameArrivedAtRef.current;
      if (
        lastFrameArrivedAt === null ||
        performance.now() - lastFrameArrivedAt <= streamStaleMs
      ) {
        return;
      }

      recordingActiveRef.current = false;
      setRecording(false);
      clearCurrentSignal();
      setState("disconnected");
      setStatusDetail("EEG stream stalled; no fresh data received.");
      void providerRef.current?.disconnect("EEG stream stalled");
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [connected]);

  async function connect() {
    setError("");
    sampleCountRef.current = 0;
    frameCountRef.current = 0;
    clearCurrentSignal();
    setSampleCount(0);
    setFrameCount(0);
    fitProviderRef.current.reset();
    resetFitCheck();
    await providerRef.current?.connectAndStart();
  }

  function startRecording() {
    recordingFramesRef.current = [];
    setRecordedFrameCount(0);
    recordingActiveRef.current = true;
    setRecording(true);
  }

  function stopRecording() {
    recordingActiveRef.current = false;
    setRecording(false);
  }

  function resetFitCheck() {
    if (fitCheckTimeoutRef.current !== null) {
      window.clearTimeout(fitCheckTimeoutRef.current);
      fitCheckTimeoutRef.current = null;
    }
    setFitCheck({
      status: "idle",
      startedAtMs: null,
      completedAtMs: null,
      result: null,
    });
  }

  function runFitCheck() {
    if (fitCheckTimeoutRef.current !== null) {
      window.clearTimeout(fitCheckTimeoutRef.current);
    }

    const nowMs = performance.now();
    fitProviderRef.current.reset();
    const initialFit = computeFitSnapshot(fitProviderRef.current, usesServerFit, {
      connectionState: state,
      deviceInfo,
      frame: latestFrame,
      nowMs,
    });
    fitSnapshotRef.current = initialFit;
    setFitSnapshot(initialFit);
    setFitCheck({
      status: "running",
      startedAtMs: nowMs,
      completedAtMs: null,
      result: null,
    });

    fitCheckTimeoutRef.current = window.setTimeout(() => {
      const currentResult =
        fitSnapshotRef.current ??
        computeFitSnapshot(fitProviderRef.current, usesServerFit, {
          connectionState: state,
          deviceInfo,
          frame: latestFrame,
        });
      const result = completeFitCheckResult(currentResult);
      fitCheckTimeoutRef.current = null;
      setFitCheck({
        status: "complete",
        startedAtMs: nowMs,
        completedAtMs: performance.now(),
        result,
      });
    }, fitCheckDurationMs);
  }

  function downloadRecording() {
    const recordingPayload = {
      format: "neurasticity-debug-recording",
      version: 1,
      createdAt: new Date().toISOString(),
      deviceInfo,
      frames: recordingFramesRef.current,
    };
    const blob = new Blob([JSON.stringify(recordingPayload)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `eeg-demo-recording-${timestamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function startAffectiveCalibration() {
    // BrainFlow and Bluetooth connections calibrate server-side (see
    // `analysis.AnalysisProviders.affective_state`) -- the next frame's
    // `features.calibrationStatus` picks up the new state (see
    // `calibrationStateFromFrame`). Providers with no server session
    // (Mock, replay) fall back to the client-only provider.
    try {
      if (providerRef.current?.startAffectiveCalibration) {
        await providerRef.current.startAffectiveCalibration();
      } else {
        affectiveProviderRef.current.startCalibration();
        setAffectiveCalibration(affectiveProviderRef.current.getCalibrationState());
      }
      calibrationStatusRef.current = "collecting";
      setMetricHistory({});
      setBaselineMetricHistory({});
      setAffectiveState(null);
    } catch (calibrationError) {
      setError(calibrationError instanceof Error ? calibrationError.message : "Unable to start metric calibration.");
    }
  }

  async function resetAffectiveCalibration() {
    try {
      if (providerRef.current?.resetAffectiveCalibration) {
        await providerRef.current.resetAffectiveCalibration();
      } else {
        affectiveProviderRef.current.resetCalibration();
        setAffectiveCalibration(affectiveProviderRef.current.getCalibrationState());
      }
      calibrationStatusRef.current = "off";
      setMetricHistory({});
      setBaselineMetricHistory({});
      setAffectiveState(null);
    } catch (calibrationError) {
      setError(calibrationError instanceof Error ? calibrationError.message : "Unable to reset metric calibration.");
    }
  }

  async function disconnect() {
    recordingActiveRef.current = false;
    setRecording(false);
    clearCurrentSignal();
    await providerRef.current?.disconnect();
  }

  function showDashboard(anchorId?: string) {
    if (!anchorId) return;

    window.setTimeout(() => {
      document.getElementById(anchorId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Application navigation">
        <div className="brand-mark" aria-label="EEG acquisition console" />
        <nav className="nav-stack">
          <button
            className="nav-button is-active"
            onClick={() => showDashboard("connection")}
            aria-label="Dashboard"
          >
            <Cable aria-hidden="true" />
          </button>
          <button
            className="nav-button"
            onClick={() => showDashboard("fit")}
            aria-label="Headset fit"
          />
          <button
            className="nav-button"
            onClick={() => showDashboard("chart")}
            aria-label="Live plot"
          />
          <button
            className="nav-button"
            onClick={() => showDashboard("channels")}
            aria-label="EEG values"
          />
        </nav>
      </aside>

      <main className="app-shell">
        <header className="page-header">
          <div>
            <h1>EEG Acquisition Console</h1>
            <p>Hardware-agnostic raw EEG acquisition and provider validation.</p>
          </div>
          <div className="header-badge">
            <Radio aria-hidden="true" />
            <span>{providerLabel || getConfiguredProviderKey()}</span>
          </div>
        </header>

        <section id="connection" className="connection-card" aria-label="Device connection controls">
          <div className={statusClassName(state)}>
            <div className="icon-tile">
              <StatusIcon state={state} />
            </div>
            <div>
              <span>Connection</span>
              <strong>{state}</strong>
              {statusDetail && <small>{statusDetail}</small>}
            </div>
          </div>
          <label className="device-selector">
            <span>Device</span>
            <div className="select-wrap">
              <Cable aria-hidden="true" />
              <select
                value={selectedDeviceId}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
                disabled={busy || connected}
              >
                {deviceCatalog.map((device) => (
                  <option
                    disabled={device.disabled}
                    key={device.id}
                    value={device.id}
                  >
                    {device.disabled
                      ? `${device.label} - ${device.detail}`
                      : `${device.label} - ${device.detail}`}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </div>
          </label>
          <div className="actions">
            <button className="primary-button" onClick={connect} disabled={busy || connected}>
              <Cable aria-hidden="true" />
              Connect
            </button>
            <button
              className="secondary-button"
              onClick={disconnect}
              disabled={!connected && !busy && state !== "error"}
            >
              <Unplug aria-hidden="true" />
              Disconnect
            </button>
            <button
              className="secondary-button"
              onClick={recording ? stopRecording : startRecording}
              disabled={!connected}
            >
              <Radio aria-hidden="true" />
              {recording ? "Stop Recording" : "Record"}
            </button>
            <button
              className="secondary-button"
              onClick={downloadRecording}
              disabled={recording || recordedFrameCount === 0}
            >
              <Download aria-hidden="true" />
              Download
            </button>
          </div>
        </section>

        {error && (
          <div className="error">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <section className="metrics" aria-label="EEG stream overview">
          <article className="metric-card">
            <div className="metric-icon">
              <Activity aria-hidden="true" />
            </div>
            <span>Frames</span>
            <strong>{frameCount}</strong>
            <small>{sampleCount} samples received</small>
          </article>
          <article className="metric-card">
            <div className="metric-icon">
              <Cable aria-hidden="true" />
            </div>
            <span>Device</span>
            <strong>{deviceInfo?.label ?? "Not connected"}</strong>
            <small>{deviceInfo?.model ?? "No active device"}</small>
          </article>
          <article className="metric-card">
            <div className="metric-icon">
              <Activity aria-hidden="true" />
            </div>
            <span>Provider</span>
            <strong>{deviceInfo?.providerName ?? providerLabel}</strong>
            <small>
              {recording
                ? `Recording ${recordedFrameCount} frames`
                : recordedFrameCount > 0
                  ? `${recordedFrameCount} recorded frames ready`
                  : deviceInfo
                  ? "Adapter normalized"
                  : "Waiting for provider"}
            </small>
          </article>
          <article className="metric-card">
            <div className="metric-icon">
              <Gauge aria-hidden="true" />
            </div>
            <span>Sample Rate</span>
            <strong>
              {eegCapability?.sampleRateHz === null || !eegCapability
                ? "pending"
                : `${eegCapability.sampleRateHz} Hz`}
            </strong>
            <small>{eegCapability?.channels.length ?? channelNames.length} EEG channels</small>
          </article>
        </section>

        <ProtocolsPanel
          protocol={protocol}
          threshold={threshold}
          protocols={protocolDefinitions}
          onProtocolChange={changeProtocol}
          onThresholdChange={changeThreshold}
          onResetThreshold={resetProtocolThreshold}
        />

        <HeadsetFitPanel
          check={fitCheck}
          fit={fitSnapshot}
          onRunCheck={runFitCheck}
          calibrationStatus={affectiveCalibration.status}
          onCalibrate={startAffectiveCalibration}
          onResetCalibration={resetAffectiveCalibration}
        />

        <AffectiveStatePanel sample={affectiveState} selectedMetric={selectedMetric} onSelectMetric={setSelectedMetric} rawMetrics={latestFrame?.features?.rawMetrics ?? {}} baselineMetrics={latestFrame?.features?.baselineRelativeMetrics ?? {}} />

        <MetricMonitorPanel
          sample={affectiveState}
          coherence={latestFrame?.features?.interhemisphericCoherence}
          history={metricHistory}
          baselineHistory={baselineMetricHistory}
          selectedMetric={selectedMetric}
          onSelectMetric={setSelectedMetric}
          calibration={affectiveCalibration}
          rawMetrics={latestFrame?.features?.rawMetrics ?? {}}
          baselineMetrics={latestFrame?.features?.baselineRelativeMetrics ?? {}}
        />

        <BandPowerMonitorPanel latest={latestBands} history={bandHistory} />

        <section id="chart" className="panel chart-card">
          <div className="panel-header">
            <div className="panel-title">
              <div className="icon-tile">
                <LineChart aria-hidden="true" />
              </div>
              <div>
                <h2>Live Plot</h2>
                <p>Recent latest sample per received frame</p>
              </div>
            </div>
            <PlotSeriesSelector options={channelNames} selected={plottedChannels} onChange={setSelectedChannels} />
          </div>
          <div className="chart-surface">
            {channelNames.length === 0 && (
              <div className="empty-state chart-empty">
                <div className="icon-tile">
                  <LineChart aria-hidden="true" />
                </div>
                <strong>Waiting for EEG frames</strong>
                <span>Connect a provider to draw incoming channel values.</span>
              </div>
            )}
            <LiveEegPlot channelNames={plottedChannels} history={plotHistory} />
          </div>
        </section>

        <section id="channels" className="panel channels-card">
          <div className="panel-header">
            <div className="panel-title">
              <div className="icon-tile">
                <Rows3 aria-hidden="true" />
              </div>
              <div>
                <h2>Latest Raw EEG Values</h2>
                <p>{channelNames.join(", ") || "Waiting for channels"}</p>
              </div>
            </div>
          </div>
          <div className="channel-grid">
            {channelNames.length === 0 ? (
              <div className="empty-state channel-empty">
                <div className="icon-tile">
                  <Cable aria-hidden="true" />
                </div>
                <strong>No channels yet</strong>
                <span>Connect a provider to populate EEG channel values.</span>
              </div>
            ) : (
              channelNames.map((name) => (
                <div className="channel-row" key={name}>
                  <span className="channel-name">{name}</span>
                  <strong>{formatValue(latest[name])}</strong>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function appendHistory(current: Record<string, number[]>, values: Record<string, number | null | undefined>) {
  const next = { ...current };
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    next[name] = [...(next[name] ?? []), value].slice(-maxHistorySamples);
  }
  return next;
}

function metricValuesFromService(metrics: Record<string, number>): Record<string, number | null> {
  const ratio = (name: string) => metrics[`ratio:${name}`] ?? null;
  return { mindfulness: metrics.mindfulness ?? null, restfulness: metrics.restfulness ?? null, valence: metrics.valence ?? null, arousal: metrics.arousal ?? null, confidence: metrics.confidence ?? null, ihc: metrics.ihc ?? null, thetaBeta: ratio("thetaBeta"), betaTheta: ratio("betaTheta"), alphaTheta: ratio("alphaTheta"), thetaAlpha: ratio("thetaAlpha"), smrTheta: ratio("smrTheta"), thetaAlphaBeta: ratio("thetaAlphaBeta"), alphaBeta: ratio("alphaBeta"), betaAlpha: ratio("betaAlpha"), arousalRatio: ratio("arousal"), valenceRatio: ratio("valence") };
}

/** Reads valence/arousal calibration progress straight off a frame's
 * server-computed `features` (see `analysis.analyze_window`, which stamps
 * every window with the connection's current calibration state) -- `null`
 * for a frame with no `features` at all (Mock, or an older replay
 * recording), so the caller can fall back to the client-only provider's
 * own calibration state in that case. */
function calibrationStateFromFrame(frame: SignalFrame): AffectiveCalibrationState | null {
  const status = frame.features?.calibrationStatus;
  if (!status) return null;

  return {
    status,
    progress: frame.features?.calibrationProgress ?? 0,
    required: frame.features?.calibrationRequired ?? 24,
  };
}

/** Picks the right source for a HeadsetFitSnapshot: Neurasticity's real
 * BrainFlow and Bluetooth paths carry a full server assessment; mock data
 * still receives a client-side heuristic. */
function computeFitSnapshot(
  fitProvider: HeuristicHeadsetFitProvider,
  usesServerFit: boolean,
  input: {
    connectionState: EegConnectionState;
    deviceInfo: DeviceInfo | null;
    frame: SignalFrame | null;
    nowMs?: number;
  },
): HeadsetFitSnapshot {
  if (usesServerFit) {
    return snapshotFromServerFit(input.connectionState, input.frame, input.nowMs ?? performance.now());
  }
  return fitProvider.update(input);
}

/** Builds a HeadsetFitSnapshot straight from a server-computed
 * assessment (SignalFrame.quality, populated by Neurasticity's EEGEngine)
 * instead of deriving one from raw
 * samples the way `HeuristicHeadsetFitProvider.update()` does. The
 * "not connected" / "stale frame" cases below are the same client-only
 * checks `update()` runs first, reproduced here because the server has no
 * notion of a browser's transport connection or its last-frame clock --
 * everything past that point is the server's assessment, verbatim. */
function snapshotFromServerFit(
  connectionState: EegConnectionState,
  frame: SignalFrame | null,
  nowMs: number,
): HeadsetFitSnapshot {
  const connected = connectionState === "connected" || connectionState === "streaming";
  if (!connected) {
    return {
      ...createInitialSnapshot(nowMs),
      state: "not_detected",
      connected: false,
      message: "Headset not detected",
      blockers: ["Connect an EEG device."],
    };
  }

  if (!frame || frameAgeMs(frame.receivedAtMs, nowMs) > defaultHeadsetFitThresholds.staleFrameMs) {
    return {
      ...createInitialSnapshot(nowMs),
      state: "not_worn",
      connected: true,
      message: "Waiting for EEG signal",
      blockers: ["Waiting for a fresh EEG signal."],
    };
  }

  const quality = frame.quality;
  if (!quality?.state) {
    // No assessment yet for this window -- the fit-quality call for it may
    // have failed, or the connection is too new to have one. Same
    // "waiting" state the client heuristic shows before it has enough
    // samples, rather than a misleading blank/poor state.
    return {
      ...createInitialSnapshot(nowMs),
      state: "not_worn",
      connected: true,
      message: "Waiting for headset fit assessment",
      blockers: ["Waiting for a fresh EEG signal."],
    };
  }

  return {
    state: quality.state,
    ready: quality.ready ?? false,
    connected: true,
    worn: quality.worn ?? false,
    source: quality.source,
    message: quality.message ?? "Check headset fit",
    blockers: quality.blockers ?? [],
    channels: (quality.channels ?? []).map((channel) => ({
      channel: channel.channel,
      state: channel.state,
      score: channel.score,
      rmsUv: channel.rmsUv,
      stdDevUv: channel.stdDevUv,
      peakToPeakUv: channel.peakToPeakUv,
      meanStepUv: channel.meanStepUv,
      maxAbsUv: channel.maxAbsUv,
      maxStepUv: channel.maxStepUv,
      clippedFraction: channel.clippedFraction,
      source: quality.source,
      message: channel.message,
    })),
    stableForMs: quality.stableForMs ?? 0,
    requiredStableMs: quality.requiredStableMs ?? defaultHeadsetFitThresholds.stableReadyMs,
    excessiveArtifact: quality.excessiveArtifact ?? false,
    updatedAtMs: nowMs,
  };
}

function completeFitCheckResult(result: HeadsetFitSnapshot): HeadsetFitSnapshot {
  const timerToleranceMs = 200;
  const passedByTolerance =
    result.state === "good" &&
    result.stableForMs >= result.requiredStableMs - timerToleranceMs &&
    !result.excessiveArtifact;

  if (!passedByTolerance) return result;

  return {
    ...result,
    state: "ready",
    ready: true,
    message: "Signal looks stable",
    blockers: [],
    stableForMs: result.requiredStableMs,
  };
}
