import { healthSchema, worldSchema, type Snapshot } from './contracts';
import { FlightConnection } from './connection';
import { FlightScene } from './scene';
import { FlightView } from './view';
import './style.css';

async function initialize(root: HTMLElement): Promise<() => void> {
  const view = new FlightView(root);
  const events = new AbortController();
  let scene: FlightScene | undefined;
  let connection: FlightConnection | undefined;
  let latest: Snapshot | null = null;
  const dispose = (): void => {
    events.abort();
    connection?.dispose();
    scene?.dispose();
    view.dispose();
  };
  try {
    const responses = await Promise.all([fetch('/api/world'), fetch('/api/health')]);
    if (responses.some((response) => !response.ok))
      throw new Error('The flight controller is offline.');
    const [worldData, healthData] = await Promise.all(responses.map((response) => response.json()));
    const world = worldSchema.parse(worldData);
    const health = healthSchema.parse(healthData);
    view.configure(health.model, health.api_configured, world.checkpoints.length);
    scene = new FlightScene(view.sceneContainer, world);
    view.bindCamera((camera) => scene?.setCamera(camera));
    const url = new URL('/ws/flight', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    connection = new FlightConnection(
      url.href,
      (snapshot) => {
        latest = snapshot;
        scene?.update(snapshot);
        view.render(snapshot);
      },
      (state) => {
        if (state !== 'connected') latest = null;
        view.setConnection(state);
      },
    );
    const options = { signal: events.signal };
    view.start.addEventListener(
      'click',
      () => connection?.send(latest?.status === 'flying' ? 'pause' : 'start'),
      options,
    );
    view.reset.addEventListener('click', () => connection?.send('reset'), options);
    view.obstacle.addEventListener('click', () => connection?.send('obstacle'), options);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden && latest?.status === 'flying') connection?.send('pause');
      },
      options,
    );
    connection.connect();
  } catch (error) {
    connection?.dispose();
    scene?.dispose();
    view.notice(error instanceof Error ? error.message : 'Unable to initialize the flight.');
    console.error('Flight initialization failed', error);
  }
  window.addEventListener('pagehide', dispose, { once: true, signal: events.signal });
  return dispose;
}

const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
const cleanup = initialize(root);
import.meta.hot?.dispose(async () => (await cleanup)());
