import * as THREE from "three";

export class PlayerController {
  public camera: THREE.PerspectiveCamera;
  public position = new THREE.Vector3(0, 1.7, 0);
  private velocity = new THREE.Vector3();
  private euler = new THREE.Euler(0, 0, 0, "YXZ");

  public health = 100;
  public maxHealth = 100;
  public isAlive = true;

  // Keyboard state
  private keys: Record<string, boolean> = {
    KeyW: false,
    KeyS: false,
    KeyA: false,
    KeyD: false,
    Space: false,
  };

  public isLocked = false;
  private moveSpeed = 8.5;
  private roomBound = 17.5; // Containment room boundary
  public cameraShake = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.copy(this.position);
    this.setupListeners();
  }

  private setupListeners() {
    window.addEventListener("keydown", (e) => {
      if (this.keys.hasOwnProperty(e.code)) {
        this.keys[e.code] = true;
      }
    });

    window.addEventListener("keyup", (e) => {
      if (this.keys.hasOwnProperty(e.code)) {
        this.keys[e.code] = false;
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isLocked) return;

      const movementX = e.movementX || 0;
      const movementY = e.movementY || 0;

      this.euler.y -= movementX * 0.0022;
      this.euler.x -= movementY * 0.0022;

      // Clamp vertical look to avoid flipping
      this.euler.x = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    });
  }

  public update(delta: number) {
    if (!this.isAlive) return;

    // Movement forward/back & strafe
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, this.euler.y, 0));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, this.euler.y, 0));

    const moveDir = new THREE.Vector3();
    if (this.keys.KeyW) moveDir.add(forward);
    if (this.keys.KeyS) moveDir.sub(forward);
    if (this.keys.KeyD) moveDir.add(right);
    if (this.keys.KeyA) moveDir.sub(right);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
      this.velocity.x += moveDir.x * this.moveSpeed * delta * 7;
      this.velocity.z += moveDir.z * this.moveSpeed * delta * 7;
    }

    // Damping / Friction
    this.velocity.x *= 1 - delta * 8;
    this.velocity.z *= 1 - delta * 8;

    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;

    // Clamp inside room walls
    this.position.x = Math.max(-this.roomBound, Math.min(this.roomBound, this.position.x));
    this.position.z = Math.max(-this.roomBound, Math.min(this.roomBound, this.position.z));

    // Camera shake decay
    this.cameraShake.lerp(new THREE.Vector3(0, 0, 0), delta * 10);

    this.camera.position.set(
      this.position.x + this.cameraShake.x,
      this.position.y + this.cameraShake.y,
      this.position.z + this.cameraShake.z
    );
  }

  public damage(amount: number) {
    this.health = Math.max(0, this.health - amount);
    // Trigger intense camera shake
    this.cameraShake.set(
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.4
    );

    if (this.health <= 0) {
      this.isAlive = false;
    }
  }

  public getForwardVector(): THREE.Vector3 {
    const v = new THREE.Vector3(0, 0, -1);
    v.applyQuaternion(this.camera.quaternion);
    return v;
  }

  public reset() {
    this.health = this.maxHealth;
    this.isAlive = true;
    this.position.set(0, 1.7, 0);
    this.velocity.set(0, 0, 0);
    this.euler.set(0, 0, 0);
    this.camera.position.copy(this.position);
    this.camera.quaternion.setFromEuler(this.euler);
  }
}
