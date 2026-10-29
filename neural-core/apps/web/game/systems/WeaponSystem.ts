import * as THREE from "three";
import type { WeaponDef, WeaponType, BulletInstance, WeaponPickup } from "../types";
import type { SoundManager } from "../audio/SoundManager";

export class WeaponSystem {
  public weapons: Record<WeaponType, WeaponDef> = {
    pistol: {
      id: "pistol",
      name: "Service 9mm",
      category: "Sidearm",
      maxAmmo: 12,
      currentAmmo: 12,
      fireRate: 0.22,
      damage: 40,
      pellets: 1,
      spread: 0.015,
      recoil: 0.03,
      autoReloadTime: 1.2,
      color: "#3fd6c0",
      unlocked: true,
    },
    shotgun: {
      id: "shotgun",
      name: "Trench Breaker",
      category: "Heavy Shotgun",
      maxAmmo: 6,
      currentAmmo: 6,
      fireRate: 0.65,
      damage: 22,
      pellets: 7,
      spread: 0.065,
      recoil: 0.09,
      autoReloadTime: 2.0,
      color: "#f2a43a",
      unlocked: false,
    },
    rifle: {
      id: "rifle",
      name: "Pulse Carbine Mk-II",
      category: "Rapid Assault",
      maxAmmo: 30,
      currentAmmo: 30,
      fireRate: 0.095,
      damage: 26,
      pellets: 1,
      spread: 0.03,
      recoil: 0.04,
      autoReloadTime: 1.7,
      color: "#7d8cff",
      unlocked: false,
    },
    plasma: {
      id: "plasma",
      name: "Mind Piercer",
      category: "Energy Cannon",
      maxAmmo: 4,
      currentAmmo: 4,
      fireRate: 0.8,
      damage: 180,
      pellets: 1,
      spread: 0.005,
      recoil: 0.12,
      autoReloadTime: 2.6,
      color: "#ff3f70",
      unlocked: false,
    },
  };

  public currentWeaponType: WeaponType = "pistol";
  public bullets: BulletInstance[] = [];
  public pickups: WeaponPickup[] = [];
  private lastFireTime = 0;
  private timeSinceLastShot = 0;
  private isAutoReloading = false;

  // 3D Gun model container attached to camera
  public gunGroup: THREE.Group;
  private gunMesh: THREE.Mesh | null = null;
  private muzzleFlashLight: THREE.PointLight;
  private recoilOffset = new THREE.Vector3(0, 0, 0);

  // Pickups group in the scene
  public pickupsSceneGroup: THREE.Group;

  constructor(private soundManager: SoundManager) {
    this.gunGroup = new THREE.Group();
    this.pickupsSceneGroup = new THREE.Group();

    // Muzzle flash light
    this.muzzleFlashLight = new THREE.PointLight(0x3fd6c0, 0, 8);
    this.muzzleFlashLight.position.set(0.2, -0.15, -0.6);
    this.gunGroup.add(this.muzzleFlashLight);

    this.buildGunModel();
  }

  public get currentWeapon(): WeaponDef {
    return this.weapons[this.currentWeaponType];
  }

  public selectWeapon(type: WeaponType): boolean {
    if (this.weapons[type].unlocked) {
      this.currentWeaponType = type;
      this.buildGunModel();
      this.soundManager.playReloadSound();
      return true;
    }
    return false;
  }

  public switchNextWeapon(): void {
    const list: WeaponType[] = ["pistol", "shotgun", "rifle", "plasma"];
    const currentIdx = list.indexOf(this.currentWeaponType);
    for (let i = 1; i <= list.length; i++) {
      const nextType = list[(currentIdx + i) % list.length]!;
      if (this.weapons[nextType].unlocked) {
        this.selectWeapon(nextType);
        break;
      }
    }
  }

  private buildGunModel() {
    // Remove previous gun mesh
    if (this.gunMesh) {
      this.gunGroup.remove(this.gunMesh);
      this.gunMesh.geometry.dispose();
      if (Array.isArray(this.gunMesh.material)) {
        this.gunMesh.material.forEach((m) => m.dispose());
      } else {
        this.gunMesh.material.dispose();
      }
    }

    const weapon = this.currentWeapon;
    const group = new THREE.Group();

    // Procedural weapon body based on weapon type
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x171b21,
      metalness: 0.85,
      roughness: 0.25,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: weapon.color,
      emissive: weapon.color,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.3,
    });

    if (weapon.id === "pistol") {
      // Sleek tactical pistol
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.32), bodyMat);
      slide.position.set(0, 0, -0.1);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), accentMat);
      grip.position.set(0, -0.1, 0);
      grip.rotation.x = 0.2;
      group.add(slide, grip);
    } else if (weapon.id === "shotgun") {
      // Heavy double-barrel combat shotgun
      const barrel1 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55), bodyMat);
      barrel1.rotation.x = Math.PI / 2;
      barrel1.position.set(-0.03, 0, -0.22);
      const barrel2 = barrel1.clone();
      barrel2.position.set(0.03, 0, -0.22);
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.2), accentMat);
      pump.position.set(0, -0.04, -0.15);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.24), bodyMat);
      stock.position.set(0, -0.06, 0.1);
      group.add(barrel1, barrel2, pump, stock);
    } else if (weapon.id === "rifle") {
      // Sci-fi bullpup assault rifle
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.52), bodyMat);
      receiver.position.set(0, 0, -0.15);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.08), accentMat);
      mag.position.set(0, -0.12, 0.06);
      mag.rotation.x = -0.2;
      const holo = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), accentMat);
      holo.position.set(0, 0.1, -0.1);
      group.add(receiver, mag, holo);
    } else {
      // Plasma Cannon
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.48, 8), bodyMat);
      core.rotation.x = Math.PI / 2;
      core.position.set(0, 0, -0.18);
      const coils = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 16), accentMat);
      coils.position.set(0, 0, -0.25);
      const emitter = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 8), accentMat);
      emitter.rotation.x = -Math.PI / 2;
      emitter.position.set(0, 0, -0.42);
      group.add(core, coils, emitter);
    }

    // Position gun at lower right of screen
    group.position.set(0.24, -0.22, -0.48);
    this.gunMesh = group as any;
    if (this.gunMesh) {
      this.gunGroup.add(this.gunMesh);
    }
    this.muzzleFlashLight.color.set(weapon.color);
  }

  public shoot(origin: THREE.Vector3, direction: THREE.Vector3): boolean {
    const weapon = this.currentWeapon;
    const now = performance.now() / 1000;

    if (now - this.lastFireTime < weapon.fireRate) {
      return false; // Rate-limited
    }

    if (weapon.currentAmmo <= 0) {
      // Empty clip click
      this.soundManager.playReloadSound();
      return false;
    }

    this.lastFireTime = now;
    this.timeSinceLastShot = 0;
    this.isAutoReloading = false;
    weapon.currentAmmo--;

    // Recoil kick
    this.recoilOffset.z = weapon.recoil;
    this.recoilOffset.y = weapon.recoil * 0.4;

    // Flash light
    this.muzzleFlashLight.intensity = 4.0;

    // Play gunshot audio
    this.soundManager.playGunshot(weapon.id);

    // Spawn bullets (single or spread pellets)
    for (let i = 0; i < weapon.pellets; i++) {
      const spreadDir = direction.clone();
      if (weapon.spread > 0) {
        spreadDir.x += (Math.random() - 0.5) * weapon.spread;
        spreadDir.y += (Math.random() - 0.5) * weapon.spread;
        spreadDir.z += (Math.random() - 0.5) * weapon.spread;
        spreadDir.normalize();
      }

      this.bullets.push({
        id: Math.random().toString(36).slice(2, 9),
        origin: { x: origin.x, y: origin.y, z: origin.z },
        position: { x: origin.x, y: origin.y, z: origin.z },
        direction: { x: spreadDir.x, y: spreadDir.y, z: spreadDir.z },
        speed: weapon.id === "plasma" ? 45 : 95,
        damage: weapon.damage,
        distanceTraveled: 0,
        maxDistance: 60,
        color: weapon.color,
        weaponType: weapon.id,
      });
    }

    return true;
  }

  public update(delta: number, playerPos: THREE.Vector3): string | null {
    const weapon = this.currentWeapon;
    this.timeSinceLastShot += delta;

    // Recoil recovery
    this.recoilOffset.lerp(new THREE.Vector3(0, 0, 0), delta * 14);
    if (this.gunMesh) {
      this.gunMesh.position.set(0.24, -0.22 + this.recoilOffset.y, -0.48 + this.recoilOffset.z);
    }

    // Dim muzzle flash
    if (this.muzzleFlashLight.intensity > 0) {
      this.muzzleFlashLight.intensity = Math.max(0, this.muzzleFlashLight.intensity - delta * 30);
    }

    // Auto-Reload Mechanic in unused time
    if (weapon.currentAmmo < weapon.maxAmmo) {
      if (this.timeSinceLastShot >= weapon.autoReloadTime) {
        weapon.currentAmmo = weapon.maxAmmo;
        this.isAutoReloading = false;
        this.soundManager.playReloadSound();
      }
    }

    // Update floating bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;
      const moveDist = b.speed * delta;
      b.position.x += b.direction.x * moveDist;
      b.position.y += b.direction.y * moveDist;
      b.position.z += b.direction.z * moveDist;
      b.distanceTraveled += moveDist;

      if (b.distanceTraveled >= b.maxDistance) {
        this.bullets.splice(i, 1);
      }
    }

    // Update pickups rotation & check player proximity
    let unlockedNotification: string | null = null;
    for (const p of this.pickups) {
      if (!p.collected && p.meshGroup) {
        p.meshGroup.rotation.y += delta * 1.5;
        p.meshGroup.position.y = 1.0 + Math.sin(performance.now() * 0.003) * 0.15;

        const dx = playerPos.x - p.position.x;
        const dz = playerPos.z - p.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 1.6) {
          p.collected = true;
          this.pickupsSceneGroup.remove(p.meshGroup);
          this.weapons[p.weaponType].unlocked = true;
          this.weapons[p.weaponType].currentAmmo = this.weapons[p.weaponType].maxAmmo;
          this.selectWeapon(p.weaponType);
          this.soundManager.playPickupSound();
          unlockedNotification = `NEW WEAPON ACQUIRED: ${this.weapons[p.weaponType].name.toUpperCase()}!`;
        }
      }
    }

    return unlockedNotification;
  }

  public spawnPickup(weaponType: WeaponType, pos: THREE.Vector3) {
    const group = new THREE.Group();
    group.position.copy(pos);

    // Glowing base pedestal
    const baseGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.2, 16);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x111418,
      metalness: 0.9,
      roughness: 0.2,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.9;
    group.add(base);

    // Floating glowing weapon holo
    const weaponColor = this.weapons[weaponType].color;
    const holoMat = new THREE.MeshStandardMaterial({
      color: weaponColor,
      emissive: weaponColor,
      emissiveIntensity: 1.0,
      wireframe: true,
    });
    const holoBox = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.6), holoMat);
    group.add(holoBox);

    // Light beacon
    const light = new THREE.PointLight(weaponColor, 2, 6);
    light.position.y = 0.2;
    group.add(light);

    const pickup: WeaponPickup = {
      id: Math.random().toString(36).slice(2, 9),
      weaponType,
      position: { x: pos.x, y: pos.y, z: pos.z },
      meshGroup: group,
      collected: false,
    };

    this.pickups.push(pickup);
    this.pickupsSceneGroup.add(group);
  }

  public getAutoReloadProgress(): number {
    const weapon = this.currentWeapon;
    if (weapon.currentAmmo >= weapon.maxAmmo) return 1.0;
    return Math.min(1.0, this.timeSinceLastShot / weapon.autoReloadTime);
  }
}
