import {
  Activity,
  CircleAlert,
  CircleCheck,
  Headphones,
  Info,
  RefreshCw,
} from "lucide-react";
import type { HeadsetFitSnapshot } from "../../signalQuality/headsetFitProvider";

export type FitCheckStatus = "idle" | "running" | "complete";

export interface FitCheckState {
  status: FitCheckStatus;
  startedAtMs: number | null;
  completedAtMs: number | null;
  result: HeadsetFitSnapshot | null;
}

interface HeadsetFitPanelProps {
  fit: HeadsetFitSnapshot;
  check: FitCheckState;
  onRunCheck: () => void;
}

const channelPositions: Record<string, string> = {
  af7: "front-left",
  af8: "front-right",
  tp9: "rear-left",
  tp10: "rear-right",
  aux1: "aux-one",
  aux2: "aux-two",
  aux3: "aux-three",
  aux4: "aux-four",
};

export function HeadsetFitPanel({ fit, check, onRunCheck }: HeadsetFitPanelProps) {
  const stableSeconds = Math.min(
    fit.requiredStableMs / 1000,
    fit.stableForMs / 1000,
  );
  const isChecking = check.status === "running";
  const checkProgress =
    check.status === "complete" && check.result
      ? check.result.ready
        ? check.result.requiredStableMs
        : check.result.stableForMs
      : fit.stableForMs;
  const checkProgressSeconds = Math.min(
    fit.requiredStableMs / 1000,
    checkProgress / 1000,
  );
  const checkResult = check.result;

  return (
    <section id="fit" className="panel headset-fit-card">
      <div className="panel-header">
        <div className="panel-title">
          <div className={`icon-tile fit-icon is-${fit.state}`}>
            {fit.ready ? <CircleCheck aria-hidden="true" /> : <Headphones aria-hidden="true" />}
          </div>
          <div>
            <h2>Headset Fit & Signal Quality</h2>
            <p>Advisory signal check inferred from normalized EEG frames.</p>
          </div>
        </div>
        <div className="fit-header-actions">
          <span className={`quality-pill is-${fit.state}`}>{fit.message}</span>
          <button
            className="secondary-button fit-check-button"
            onClick={onRunCheck}
            disabled={isChecking}
          >
            <RefreshCw aria-hidden="true" className={isChecking ? "spin" : ""} />
            {isChecking
              ? "Checking"
              : check.status === "complete"
                ? "Re-run Check"
                : "Run Check"}
          </button>
        </div>
      </div>

      <div className="fit-grid">
        <div className="headset-map" aria-label="EEG channel signal quality">
          <div className="head-outline">
            <div className="head-band" />
            {fit.channels.length === 0 ? (
              <div className="empty-state map-empty">
                <div className="icon-tile">
                  <Activity aria-hidden="true" />
                </div>
                <strong>No EEG channels</strong>
                <span>Connect a headset to inspect channel signal quality.</span>
              </div>
            ) : (
              fit.channels.map((channel, index) => (
                <div
                  className={`electrode-dot is-${channel.state} ${
                    channelPositions[channel.channel.id] ?? `fallback-${index}`
                  }`}
                  key={channel.channel.id}
                  title={`${channel.channel.label}: ${channel.message}`}
                >
                  <span>{channel.channel.label}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="fit-feedback">
          <div className="fit-progress-block">
            <div className="fit-status-row">
              <span>{isChecking ? "Check sample" : "Stable signal"}</span>
              <strong>
                {(isChecking || check.status === "complete"
                  ? checkProgressSeconds
                  : stableSeconds
                ).toFixed(1)}s / {(fit.requiredStableMs / 1000).toFixed(1)}s
              </strong>
            </div>
            <div className="fit-progress" aria-hidden="true">
              <span
                style={{
                  width: `${Math.min(
                    100,
                    ((isChecking || check.status === "complete"
                      ? checkProgress
                      : fit.stableForMs) /
                      fit.requiredStableMs) *
                      100,
                  )}%`,
                }}
              />
            </div>
          </div>

          <div
            className={`fit-check-result ${
              checkResult ? `is-${checkResult.ready ? "ready" : "needs-adjustment"}` : ""
            }`}
          >
            {checkResult?.ready ? (
              <CircleCheck aria-hidden="true" />
            ) : (
              <CircleAlert aria-hidden="true" />
            )}
            <div>
              <strong>{fitCheckTitle(check)}</strong>
              <span>{fitCheckDescription(check, fit)}</span>
            </div>
          </div>

          <div className="quality-note">
            <Info aria-hidden="true" />
            <p>
              This estimates EEG signal plausibility. It does not prove electrode contact
              or exact physical headset position.
            </p>
          </div>

          {fit.blockers.length > 0 ? (
            <ul className="fit-blockers">
              {fit.blockers.map((blocker) => (
                <li key={blocker}>
                  <CircleAlert aria-hidden="true" />
                  <span>{blocker}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="fit-ready">
              <CircleCheck aria-hidden="true" />
              <span>Signal looks stable enough for training.</span>
            </div>
          )}

          <div className="channel-quality-list">
            {fit.channels.map((channel) => (
              <div className="channel-quality-row" key={channel.channel.id}>
                <span>{channel.channel.label}</span>
                <strong>{channel.state}</strong>
                <small>{channel.message}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function fitCheckTitle(check: FitCheckState) {
  if (check.status === "running") return "Validating 3.5-second sample";
  if (!check.result) return "No manual check yet";
  return check.result.ready ? "Manual check passed" : "Manual check needs review";
}

function fitCheckDescription(check: FitCheckState, liveFit: HeadsetFitSnapshot) {
  if (check.status === "running") {
    return liveFit.blockers[0] ?? liveFit.message;
  }

  if (!check.result) {
    return "Run a check after connecting the headset to validate the current fit.";
  }

  if (check.result.ready) {
    return "Signal stayed stable for the required sample window.";
  }

  return check.result.blockers[0] ?? check.result.message;
}

