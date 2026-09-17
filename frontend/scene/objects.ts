import * as THREE from 'three';
import type { Obstacle, Vector3, World } from '../contracts';

export const LIME = 0xc7f55c;
export const toVector = (value: Vector3): THREE.Vector3 =>
  new THREE.Vector3(value.x, value.y, value.z);
export type GateRing = THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;

export function createGround(world: World): THREE.Group {
  const group = new THREE.Group();
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(40, 0.65, 40),
    new THREE.MeshStandardMaterial({ color: '#243138', roughness: 0.95 }),
  );
  platform.position.y = -0.4;
  platform.receiveShadow = true;
  group.add(platform);
  const grid = new THREE.GridHelper(40, 40, 0x496064, 0x34474d);
  grid.position.y = -0.06;
  group.add(grid);
  const perimeter = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-19, 0, -19),
      new THREE.Vector3(19, 0, -19),
      new THREE.Vector3(19, 0, 19),
      new THREE.Vector3(-19, 0, 19),
    ]),
    new THREE.LineBasicMaterial({ color: 0x7c918b }),
  );
  group.add(perimeter);
  [world.start, world.checkpoints[world.checkpoints.length - 1].position].forEach(
    (position, index) => {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(2, 2, 0.09, 64),
        new THREE.MeshStandardMaterial({ color: index ? '#637445' : '#53685c' }),
      );
      pad.position.set(position.x, 0.01, position.z);
      pad.receiveShadow = true;
      group.add(pad);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.7, 1.76, 64),
        new THREE.MeshBasicMaterial({ color: LIME, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(position.x, 0.065, position.z);
      group.add(ring);
      const marker = textLabel(index ? 'FINISH' : 'START', '#d9efb2', 2.5);
      marker.position.set(position.x, 0.2, position.z + 2.8);
      group.add(marker);
    },
  );
  const north = textLabel('N  /  −Z', '#899c9e', 3);
  north.position.set(0, 0, -22);
  group.add(north);
  return group;
}
export function createObstacle(obstacle: Obstacle): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(obstacle.size.x, obstacle.size.y, obstacle.size.z);
  const body = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: obstacle.color,
      roughness: 0.8,
      metalness: 0.12,
    }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: '#a0adb1', transparent: true, opacity: 0.22 }),
  );
  group.add(edges);
  // Floor bands make building height legible without textures or external assets.
  for (let height = 1.3; height < obstacle.size.y - 0.4; height += 1.4) {
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(obstacle.size.x + 0.025, 0.07, obstacle.size.z + 0.025),
      new THREE.MeshStandardMaterial({ color: '#2d3b40', roughness: 1 }),
    );
    band.position.y = height - obstacle.size.y / 2;
    group.add(band);
  }
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(obstacle.size.x * 0.5, 0.2, obstacle.size.z * 0.5),
    new THREE.MeshStandardMaterial({ color: '#78868a', roughness: 0.7 }),
  );
  roof.position.y = obstacle.size.y / 2 + 0.1;
  group.add(roof);
  group.position.copy(toVector(obstacle.center));
  return group;
}

export function createRoute(world: World): { group: THREE.Group; rings: GateRing[] } {
  const routeGroup = new THREE.Group();
  const rings: GateRing[] = [];
  const route = [world.start, ...world.checkpoints.map((point) => point.position)];
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(route.map(toVector)),
    new THREE.LineDashedMaterial({
      color: 0x8aafa7,
      transparent: true,
      opacity: 0.35,
      dashSize: 0.45,
      gapSize: 0.35,
    }),
  );
  line.computeLineDistances();
  routeGroup.add(line);
  world.checkpoints.forEach((point, index) => {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.035, 8, 64),
      new THREE.MeshBasicMaterial({
        color: LIME,
        transparent: true,
        opacity: index === 0 ? 1 : 0.3,
      }),
    );
    const direction = toVector(point.position).sub(toVector(route[index]));
    ring.rotation.y = Math.atan2(direction.x, direction.z);
    group.add(ring);
    const label = textLabel(`0${index + 1}`, '#c7f55c', 1.1);
    label.position.y = 2;
    group.add(label);
    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -point.position.y + 0.05, 0),
        new THREE.Vector3(0, -1.3, 0),
      ]),
      new THREE.LineDashedMaterial({
        color: LIME,
        transparent: true,
        opacity: 0.25,
        dashSize: 0.2,
        gapSize: 0.2,
      }),
    );
    stem.computeLineDistances();
    group.add(stem);
    group.position.copy(toVector(point.position));
    rings.push(ring);
    routeGroup.add(group);
  });
  return { group: routeGroup, rings };
}
export function createDrone(radius: number): { group: THREE.Group; propellers: THREE.Group[] } {
  const group = new THREE.Group();
  const propellers: THREE.Group[] = [];
  // Rotor envelope in model units, scaled to the server collision radius.
  group.scale.setScalar(radius / 1.42);
  const shell = new THREE.MeshStandardMaterial({
    color: '#d8e2d5',
    roughness: 0.45,
    metalness: 0.35,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#1b272e',
    roughness: 0.35,
    metalness: 0.7,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.24, 0.9), shell);
  body.castShadow = true;
  group.add(body);
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(0.37, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.12 }),
  );
  top.position.y = 0.16;
  group.add(top);
  for (const x of [-0.66, 0.66]) {
    for (const z of [-0.66, 0.66]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.09, 0.1), dark);
      arm.position.set(x / 2, 0, z / 2);
      arm.rotation.y = -Math.atan2(z, x);
      group.add(arm);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.18, 16), dark);
      motor.position.set(x, 0.08, z);
      group.add(motor);
      const propeller = new THREE.Group();
      for (const rotation of [0, Math.PI / 2]) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.83, 0.015, 0.08), shell);
        blade.rotation.y = rotation;
        propeller.add(blade);
      }
      propeller.position.set(x, 0.2, z);
      propellers.push(propeller);
      group.add(propeller);
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.018, 6, 32), dark);
      guard.rotation.x = Math.PI / 2;
      guard.position.set(x, 0.15, z);
      group.add(guard);
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 8),
        new THREE.MeshBasicMaterial({ color: z > 0 ? LIME : 0x74cef7 }),
      );
      light.position.set(x, 0, z + Math.sign(z) * 0.16);
      group.add(light);
    }
  }
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), dark);
  lens.position.set(0, -0.07, 0.49);
  group.add(lens);
  return { group, propellers };
}
function textLabel(text: string, color: string, width: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable.');
  context.font = '600 40px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = color;
  context.fillText(text, 128, 48);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(width, (width * 96) / 256, 1);
  return sprite;
}
