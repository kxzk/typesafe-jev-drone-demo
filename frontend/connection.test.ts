import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlightConnection } from './connection';

class SocketStub {
  static OPEN = 1;
  static instances: SocketStub[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    SocketStub.instances.push(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  SocketStub.instances = [];
});

describe('flight connection lifecycle', () => {
  it('pauses and closes on invalid data without invoking the renderer', () => {
    vi.stubGlobal('WebSocket', SocketStub);
    const render = vi.fn();
    const state = vi.fn();
    const connection = new FlightConnection('ws://test', render, state);
    connection.connect();
    const socket = SocketStub.instances[0];
    socket.onmessage?.({ data: '{invalid' });
    expect(socket.send).toHaveBeenCalledWith('{"action":"pause"}');
    expect(socket.close).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
    expect(state).toHaveBeenLastCalledWith('invalid');
  });

  it('cancels a scheduled reconnect when disposed', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', SocketStub);
    const connection = new FlightConnection('ws://test', vi.fn(), vi.fn());
    connection.connect();
    SocketStub.instances[0].onclose?.();
    connection.dispose();
    vi.runAllTimers();
    expect(SocketStub.instances).toHaveLength(1);
  });
});
