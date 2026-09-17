import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { disposeObject } from './resources';

describe('scene resource ownership', () => {
  it('disposes shared geometry, material, and sprite texture once', () => {
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(geometry, material),
      new THREE.Mesh(geometry, material),
      new THREE.Sprite(spriteMaterial),
    );
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const disposeTexture = vi.spyOn(texture, 'dispose');
    disposeObject(root);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeTexture).toHaveBeenCalledOnce();
  });
});
