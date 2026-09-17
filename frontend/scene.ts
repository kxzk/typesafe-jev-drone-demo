import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraMode, Snapshot, World } from './contracts';
import {
  createDrone,
  createGround,
  createObstacle,
  createRoute,
  LIME,
  toVector,
} from './scene/objects';
import { disposeObject } from './scene/resources';

export class FlightScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(44, 1, 0.1, 400);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly controls: OrbitControls;
  private readonly drone;
  private readonly route;
  private readonly obstacleMeshes = new Map<string, THREE.Group>();
  private readonly trailPositions = new Float32Array(600 * 3);
  private readonly trail = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: LIME }),
  );
  private readonly destination: THREE.Vector3;
  private readonly velocity = new THREE.Vector3();
  private readonly shadow = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.8, 40),
    new THREE.MeshBasicMaterial({
      color: LIME,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
  );
  private readonly resizeObserver = new ResizeObserver(() => this.resize());
  private cameraMode: CameraMode = 'orbit';
  private flying = false;
  private lastFrame = performance.now();

  constructor(
    private readonly container: HTMLElement,
    private readonly world: World,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Drone course. Drag to orbit; scroll to zoom.',
    );
    this.container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color('#151f23');
    this.scene.add(new THREE.HemisphereLight(0xc8e6f2, 0x34403e, 2.8));
    const sun = new THREE.DirectionalLight(0xf4f1df, 3.5);
    sun.position.set(-15, 35, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 90 });
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 200;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.drone = createDrone(world.drone_radius);
    this.route = createRoute(world);
    this.destination = toVector(world.start);
    this.drone.group.position.copy(this.destination);
    this.shadow.rotation.x = -Math.PI / 2;
    this.trail.geometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail.geometry.setDrawRange(0, 0);
    this.trail.frustumCulled = false;
    this.scene.add(
      createGround(world),
      this.route.group,
      this.drone.group,
      this.trail,
      this.shadow,
    );
    this.syncObstacles(world.obstacles);
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.animate());
  }

  update(snapshot: Snapshot): void {
    this.flying = snapshot.status === 'flying';
    this.destination.copy(toVector(snapshot.position));
    this.velocity.copy(toVector(snapshot.velocity));
    if (snapshot.status === 'ready') this.drone.group.position.copy(this.destination);
    const path = snapshot.path.slice(-600);
    path.forEach((point, index) => this.trailPositions.set([point.x, point.y, point.z], index * 3));
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, path.length);
    this.syncObstacles(snapshot.obstacles);
    this.route.rings.forEach((ring, index) => {
      ring.material.color.set(index < snapshot.checkpoint_index ? 0x5b8680 : LIME);
      ring.material.opacity = index === snapshot.checkpoint_index ? 1 : 0.3;
    });
  }

  private syncObstacles(obstacles: World['obstacles']): void {
    const ids = new Set(obstacles.map((obstacle) => obstacle.id));
    for (const [id, mesh] of this.obstacleMeshes) {
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        disposeObject(mesh);
        this.obstacleMeshes.delete(id);
      }
    }
    for (const obstacle of obstacles) {
      if (this.obstacleMeshes.has(obstacle.id)) continue;
      const mesh = createObstacle(obstacle);
      this.obstacleMeshes.set(obstacle.id, mesh);
      this.scene.add(mesh);
    }
  }

  setCamera(mode: CameraMode): void {
    this.cameraMode = mode;
    this.controls.enabled = mode === 'orbit';
    this.frameCourse();
  }

  private frameCourse(): void {
    if (this.cameraMode === 'follow') return;
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const distance =
      (this.world.boundary * 1.45) / Math.sin(Math.min(verticalFov, horizontalFov) / 2);
    const direction =
      this.cameraMode === 'top' ? new THREE.Vector3(0, 1, 0.001) : new THREE.Vector3(1, 0.9, 1.15);
    this.camera.position.copy(direction.normalize().multiplyScalar(distance));
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    if (this.controls.enabled) this.controls.update();
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.frameCourse();
  }

  private animate(): void {
    const now = performance.now();
    const delta = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    const drone = this.drone.group;
    drone.position.lerp(this.destination, 1 - Math.exp(-delta * 14));
    drone.rotation.z = THREE.MathUtils.lerp(drone.rotation.z, -this.velocity.x * 0.055, delta * 5);
    drone.rotation.x = THREE.MathUtils.lerp(drone.rotation.x, this.velocity.z * 0.055, delta * 5);
    if (this.velocity.length() > 0.2) {
      const yaw = Math.atan2(this.velocity.x, this.velocity.z);
      drone.rotation.y +=
        Math.atan2(Math.sin(yaw - drone.rotation.y), Math.cos(yaw - drone.rotation.y)) * delta * 4;
    }
    this.drone.propellers.forEach((propeller, index) => {
      propeller.rotation.y += delta * (this.flying ? 60 : 8) * (index % 2 ? 1 : -1);
    });
    this.shadow.position.set(drone.position.x, 0.075, drone.position.z);
    if (this.cameraMode === 'follow') {
      this.camera.position.lerp(
        drone.position.clone().add(new THREE.Vector3(7, 5, 9)),
        1 - Math.exp(-delta * 3),
      );
      this.camera.lookAt(drone.position);
    } else if (this.controls.enabled) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Light && object.shadow) object.shadow.dispose();
    });
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
