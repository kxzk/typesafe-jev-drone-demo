import {
  actionLabels,
  actionSchema,
  cameraSchema,
  type CameraMode,
  type Decision,
  type FlightStatus,
  type Snapshot,
} from './contracts';
import type { ConnectionState } from './connection';
import layout from './layout.html?raw';

function requireElement<T extends HTMLElement>(
  root: HTMLElement,
  id: string,
  elementType: new () => T,
): T {
  const node = root.querySelector(`#${id}`);
  if (!(node instanceof elementType))
    throw new Error(`Missing or invalid interface element: ${id}`);
  return node;
}

export class FlightView {
  readonly sceneContainer: HTMLDivElement;
  readonly start: HTMLButtonElement;
  readonly reset: HTMLButtonElement;
  readonly obstacle: HTMLButtonElement;
  private readonly inspector: HTMLDialogElement;
  private readonly inspect: HTMLButtonElement;
  private readonly nodes;
  private readonly probabilityRows;
  private readonly cameraButtons;
  private readonly events = new AbortController();
  private connected = false;
  private apiConfigured = false;
  private snapshot: Snapshot | null = null;
  private decisionSequence: number | null = null;
  private checkpointCount = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = layout;
    this.sceneContainer = requireElement(root, 'scene', HTMLDivElement);
    this.start = requireElement(root, 'start', HTMLButtonElement);
    this.reset = requireElement(root, 'reset', HTMLButtonElement);
    this.obstacle = requireElement(root, 'obstacle', HTMLButtonElement);
    this.inspector = requireElement(root, 'inspector', HTMLDialogElement);
    this.inspect = requireElement(root, 'inspect', HTMLButtonElement);
    this.nodes = {
      'probability-bars': requireElement(root, 'probability-bars', HTMLElement),
      'model-name': requireElement(root, 'model-name', HTMLElement),
      'checkpoint-count': requireElement(root, 'checkpoint-count', HTMLElement),
      'connection-text': requireElement(root, 'connection-text', HTMLElement),
      'connection-dot': requireElement(root, 'connection-dot', HTMLElement),
      'flight-status': requireElement(root, 'flight-status', HTMLElement),
      notice: requireElement(root, 'notice', HTMLElement),
      altitude: requireElement(root, 'altitude', HTMLElement),
      speed: requireElement(root, 'speed', HTMLElement),
      distance: requireElement(root, 'distance', HTMLElement),
      'flight-time': requireElement(root, 'flight-time', HTMLElement),
      clearance: requireElement(root, 'clearance', HTMLElement),
      interventions: requireElement(root, 'interventions', HTMLElement),
      'chosen-action': requireElement(root, 'chosen-action', HTMLElement),
      'decision-number': requireElement(root, 'decision-number', HTMLElement),
      latency: requireElement(root, 'latency', HTMLElement),
      confidence: requireElement(root, 'confidence', HTMLElement),
      obstructed: requireElement(root, 'obstructed', HTMLElement),
      'decision-note': requireElement(root, 'decision-note', HTMLElement),
      payload: requireElement(root, 'payload', HTMLElement),
    };
    this.probabilityRows = actionSchema.options.map((action) => {
      const row = document.createElement('div');
      row.className = 'probability-row';
      const label = document.createElement('span');
      label.textContent = actionLabels[action];
      const value = document.createElement('span');
      value.className = 'probability-value';
      value.textContent = '—';
      const meter = document.createElement('meter');
      meter.min = 0;
      meter.max = 1;
      meter.value = 0;
      meter.setAttribute('aria-label', actionLabels[action]);
      row.append(label, value, meter);
      this.nodes['probability-bars'].append(row);
      return { action, row, value, meter };
    });
    this.cameraButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-camera]')].map(
      (button) => ({
        button,
        camera: cameraSchema.parse(button.dataset.camera),
      }),
    );
    this.inspect.addEventListener('click', () => this.inspector.showModal(), {
      signal: this.events.signal,
    });
    requireElement(root, 'close-inspector', HTMLButtonElement).addEventListener(
      'click',
      () => this.inspector.close(),
      { signal: this.events.signal },
    );
  }

  configure(model: string, apiConfigured: boolean, checkpointCount: number): void {
    this.apiConfigured = apiConfigured;
    this.checkpointCount = checkpointCount;
    this.nodes['model-name'].textContent = model;
    this.nodes['checkpoint-count'].textContent = `0 / ${checkpointCount} checkpoints`;
  }

  bindCamera(setCamera: (camera: CameraMode) => void): void {
    this.cameraButtons.forEach(({ button, camera }) => {
      button.addEventListener(
        'click',
        () => {
          setCamera(camera);
          this.cameraButtons.forEach((item) =>
            item.button.setAttribute('aria-pressed', String(item.button === button)),
          );
        },
        { signal: this.events.signal },
      );
    });
  }

  setConnection(state: ConnectionState): void {
    this.connected = state === 'connected';
    const labels: Record<ConnectionState, string> = {
      connecting: 'Connecting',
      connected: 'Connected',
      disconnected: 'Reconnecting',
      invalid: 'Invalid telemetry',
    };
    this.nodes['connection-text'].textContent = labels[state];
    this.nodes['connection-dot'].classList.toggle('active', this.connected);
    if (!this.connected) {
      this.snapshot = null;
      this.renderDecision(null);
      this.nodes['flight-status'].textContent = 'Disconnected';
      this.notice(
        state === 'invalid'
          ? 'Invalid telemetry. Reload to reconnect.'
          : 'Connecting to the flight controller…',
      );
    }
    this.updateControls();
  }

  notice(message: string | null): void {
    this.nodes.notice.hidden = !message;
    this.nodes.notice.textContent = message;
  }

  render(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    this.nodes.altitude.textContent = snapshot.position.y.toFixed(1);
    this.nodes.speed.textContent = Math.hypot(
      snapshot.velocity.x,
      snapshot.velocity.y,
      snapshot.velocity.z,
    ).toFixed(1);
    this.nodes.distance.textContent = snapshot.distance_flown.toFixed(1);
    this.nodes['flight-time'].textContent = `${Math.floor(snapshot.elapsed / 60)
      .toString()
      .padStart(2, '0')}:${Math.floor(snapshot.elapsed % 60)
      .toString()
      .padStart(2, '0')}`;
    const status: Record<FlightStatus, string> = {
      ready: 'Ready',
      flying: snapshot.thinking ? 'Evaluating…' : 'Flying',
      paused: 'Paused',
      complete: 'Mission complete',
    };
    this.nodes['flight-status'].textContent = status[snapshot.status];
    this.nodes['checkpoint-count'].textContent =
      `${snapshot.checkpoint_index} / ${this.checkpointCount} checkpoints`;
    this.nodes.clearance.textContent = `${snapshot.clearance.toFixed(1)} m clearance`;
    this.nodes.interventions.textContent = String(snapshot.interventions);
    if ((snapshot.decision?.sequence ?? null) !== this.decisionSequence)
      this.renderDecision(snapshot.decision);
    this.notice(
      snapshot.error ??
        (this.apiConfigured ? null : 'Configure the TypeSafe API key to start a flight.'),
    );
    this.updateControls();
  }

  private renderDecision(decision: Decision | null): void {
    this.decisionSequence = decision?.sequence ?? null;
    this.nodes['chosen-action'].textContent = decision
      ? actionLabels[decision.applied_action]
      : 'Ready';
    this.nodes['decision-number'].textContent = `Decision ${decision?.sequence ?? '—'}`;
    this.nodes.latency.textContent = decision ? `${Math.round(decision.latency_ms)} ms` : '— ms';
    this.nodes.confidence.textContent = decision
      ? `${Math.round(decision.confidence * 100)}%`
      : '—';
    this.nodes.obstructed.textContent = decision
      ? `${Math.round(decision.obstructed * 100)}%`
      : '—';
    this.nodes['decision-note'].hidden = !decision || decision.action === decision.applied_action;
    this.nodes['decision-note'].textContent = decision?.note ?? '';
    this.inspect.disabled = !decision;
    this.nodes.payload.textContent = JSON.stringify(decision, null, 2);
    for (const { action, row, value, meter } of this.probabilityRows) {
      const probability = decision?.probabilities[action] ?? 0;
      row.classList.toggle('active', decision?.action === action);
      value.textContent = decision ? `${(probability * 100).toFixed(1)}%` : '—';
      meter.value = probability;
    }
  }

  private updateControls(): void {
    const status = this.snapshot?.status ?? 'ready';
    const labels: Record<FlightStatus, string> = {
      ready: 'Start flight',
      flying: 'Pause',
      paused: 'Resume',
      complete: 'Complete',
    };
    this.start.textContent = labels[status];
    this.start.disabled =
      !this.connected || !this.snapshot || !this.apiConfigured || status === 'complete';
    this.reset.disabled = !this.connected || !this.snapshot;
    this.obstacle.disabled =
      !this.connected || !this.snapshot || this.snapshot.obstacle_added || status === 'complete';
  }

  dispose(): void {
    this.events.abort();
    this.inspector.close();
  }
}
