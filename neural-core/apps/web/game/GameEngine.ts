import * as THREE from "three";
import { SoundManager } from "./audio/SoundManager";
import { WeaponSystem } from "./systems/WeaponSystem";
import { EnemySystem } from "./systems/EnemySystem";
import { RoomEnvironment } from "./systems/RoomEnvironment";
import { PlayerController } from "./systems/PlayerController";
import type { GameStats, WeaponType } from "./types";
import { ROUND_DURATION_S } from "@neural-core/shared";

export class GameEngine {
  public scene: THREE.Scene;
  public renderer: THREE.WebGLRenderer;
  public player: PlayerController;
  public weapons: WeaponSystem;
  public enemies: EnemySystem;
  public room: RoomEnvironment;
  public sound: SoundManager;

  public stats: GameStats = {
    score: 0,
    multiplier: 1,
    comboStreak: 0,
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    accuracy: 100,
    timeRemaining: ROUND_DURATION_S,
    isGameOver: false,
    isVictory: false,
    bossSpawned: false,
  };

  private lastTime = 0;
  private animationFrameId: number | null = null;
  private isRunning = false;

  // Visual bullet meshes in 3D
  private bulletMeshes: Map<string, THREE.Mesh> = new Map();
  private bulletGroup: THREE.Group;

  // Event callbacks for UI
  public onStatsUpdate?: (stats: GameStats) => void;
  public onHitFeedback?: (damage: number) => void;
  public onWeaponUnlocked?: (msg: string) => void;
  public onGameOver?: (stats: GameStats) => void;

  // Spawns for new weapon crates
  private weaponCrateTimes = [
    { time: 75, type: "shotgun" as WeaponType, pos: new THREE.Vector3(-8, 0, -8), spawned: false },
    { time: 55, type: "rifle" as WeaponType, pos: new THREE.Vector3(8, 0, -8), spawned: false },
    { time: 35, type: "plasma" as WeaponType, pos: new THREE.Vector3(0, 0, 10), spawned: false },
  ];

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.sound = new SoundManager();
    this.player = new PlayerController();
    this.weapons = new WeaponSystem(this.sound);
    this.enemies = new EnemySystem(this.sound);
    this.room = new RoomEnvironment(this.scene);

    this.bulletGroup = new THREE.Group();
    this.scene.add(this.bulletGroup);
    this.scene.add(this.enemies.enemiesGroup);
    this.scene.add(this.weapons.pickupsSceneGroup);

    // Attach gun to camera
    this.player.camera.add(this.weapons.gunGroup);
    this.scene.add(this.player.camera);

    window.addEventListener("resize", this.handleResize);
  }

  private handleResize = () => {
    this.player.camera.aspect = window.innerWidth / window.innerHeight;
    this.player.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.sound.startTenseMusic();
    this.loop(this.lastTime);
  }

  public stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.sound.stopAll();
  }

  public fireCurrentWeapon(): boolean {
    if (this.stats.isGameOver) return false;
    const origin = this.player.camera.position.clone();
    const dir = this.player.getForwardVector();

    const didFire = this.weapons.shoot(origin, dir);
    if (didFire) {
      this.stats.shotsFired++;
      this.recalculateAccuracy();
      this.onStatsUpdate?.(this.stats);
    }
    return didFire;
  }

  private loop = (time: number) => {
    if (!this.isRunning) return;
    const delta = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    this.update(delta);
    this.renderer.render(this.scene, this.player.camera);

    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private update(delta: number) {
    if (this.stats.isGameOver) return;

    // Timer countdown
    this.stats.timeRemaining = Math.max(0, this.stats.timeRemaining - delta);
    if (this.stats.timeRemaining <= 0) {
      this.triggerGameOver(true);
      return;
    }

    // Spawn weapon crates at milestone times
    for (const crate of this.weaponCrateTimes) {
      if (!crate.spawned && this.stats.timeRemaining <= crate.time) {
        crate.spawned = true;
        this.weapons.spawnPickup(crate.type, crate.pos);
        this.onWeaponUnlocked?.(`A weapon crate has materialized in the bunker!`);
      }
    }

    // Player update
    this.player.update(delta);

    // Check player health
    if (!this.player.isAlive) {
      this.triggerGameOver(false);
      return;
    }

    // Room update
    this.room.update(delta);

    // Weapons & auto-reload update
    const unlockMsg = this.weapons.update(delta, this.player.position);
    if (unlockMsg) {
      this.onWeaponUnlocked?.(unlockMsg);
    }

    // Enemies update
    const enemyResult = this.enemies.update(delta, this.player.position, this.stats.timeRemaining);
    if (enemyResult.playerDamaged > 0) {
      this.player.damage(enemyResult.playerDamaged);
      this.stats.comboStreak = 0;
      this.stats.multiplier = 1;
    }

    this.stats.bossSpawned = this.enemies.bossSpawned;

    // Update bullet meshes & check collisions
    this.updateBullets(delta);

    // Adjust music tension based on distance to nearest enemy
    let nearestDist = 999;
    for (const e of this.enemies.enemiesGroup.children) {
      const d = e.position.distanceTo(this.player.position);
      if (d < nearestDist) nearestDist = d;
    }
    const tension = Math.max(0, 1 - nearestDist / 20);
    this.sound.setTensionIntensity(tension);

    this.onStatsUpdate?.(this.stats);
  }

  private updateBullets(delta: number) {
    const activeBulletIds = new Set<string>();

    for (const b of this.weapons.bullets) {
      activeBulletIds.add(b.id);
      let mesh = this.bulletMeshes.get(b.id);

      if (!mesh) {
        const geo = new THREE.SphereGeometry(b.weaponType === "plasma" ? 0.35 : 0.08, 6, 6);
        const mat = new THREE.MeshBasicMaterial({ color: b.color });
        mesh = new THREE.Mesh(geo, mat);
        this.bulletGroup.add(mesh);
        this.bulletMeshes.set(b.id, mesh);
      }

      mesh.position.set(b.position.x, b.position.y, b.position.z);

      // Check collision with enemies
      for (const enemy of this.enemies.enemies) {
        if (!enemy.isAlive) continue;

        const enemyPos = enemy.meshGroup.position;
        const dx = b.position.x - enemyPos.x;
        const dy = b.position.y - (enemyPos.y + 1.2 * enemy.scale);
        const dz = b.position.z - enemyPos.z;
        const hitRadius = (enemy.type === "boss" ? 1.8 : 0.9) * enemy.scale;

        if (dx * dx + dy * dy + dz * dz < hitRadius * hitRadius) {
          // Bullet hit!
          b.distanceTraveled = b.maxDistance; // Mark bullet dead
          this.stats.shotsHit++;
          this.stats.comboStreak++;

          // Multiplier increments with streak
          if (this.stats.comboStreak >= 15) this.stats.multiplier = 3;
          else if (this.stats.comboStreak >= 6) this.stats.multiplier = 2;
          else this.stats.multiplier = 1;

          this.recalculateAccuracy();
          this.onHitFeedback?.(b.damage);

          const { killed, enemy: deadEnemy } = this.enemies.takeDamage(enemy.id, b.damage);
          if (killed && deadEnemy) {
            this.stats.kills++;
            this.stats.score += deadEnemy.points * this.stats.multiplier;
          }
          break;
        }
      }
    }

    // Clean up dead bullet meshes
    for (const [id, mesh] of this.bulletMeshes.entries()) {
      if (!activeBulletIds.has(id)) {
        this.bulletGroup.remove(mesh);
        mesh.geometry.dispose();
        this.bulletMeshes.delete(id);
      }
    }
  }

  private recalculateAccuracy() {
    if (this.stats.shotsFired > 0) {
      this.stats.accuracy = Math.round((this.stats.shotsHit / this.stats.shotsFired) * 100);
    }
  }

  private triggerGameOver(victory: boolean) {
    this.stats.isGameOver = true;
    this.stats.isVictory = victory;
    this.stop();
    this.onGameOver?.(this.stats);
  }

  public restart() {
    this.stats = {
      score: 0,
      multiplier: 1,
      comboStreak: 0,
      kills: 0,
      shotsFired: 0,
      shotsHit: 0,
      accuracy: 100,
      timeRemaining: ROUND_DURATION_S,
      isGameOver: false,
      isVictory: false,
      bossSpawned: false,
    };

    this.player.reset();
    this.enemies.reset();
    for (const crate of this.weaponCrateTimes) {
      crate.spawned = false;
    }
    this.weapons.selectWeapon("pistol");
    this.start();
  }

  public destroy() {
    this.stop();
    window.removeEventListener("resize", this.handleResize);
    this.renderer.dispose();
  }
}
