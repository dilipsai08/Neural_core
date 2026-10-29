import * as THREE from "three";
import type { EnemyInstance, EnemyType } from "../types";
import { ENEMY_POINTS } from "@neural-core/shared";
import type { SoundManager } from "../audio/SoundManager";

export class EnemySystem {
  public enemies: EnemyInstance[] = [];
  public enemiesGroup: THREE.Group;
  private spawnTimer = 0;
  private spawnInterval = 2.2;
  private maxEnemies = 16;
  public bossSpawned = false;

  constructor(private soundManager: SoundManager) {
    this.enemiesGroup = new THREE.Group();
  }

  public update(delta: number, playerPos: THREE.Vector3, timeRemaining: number): { playerDamaged: number; hitsLanded: number } {
    let playerDamaged = 0;
    this.spawnTimer += delta;

    // Trigger Boss in final 20 seconds as per info.md spec
    if (timeRemaining <= 20 && !this.bossSpawned) {
      this.bossSpawned = true;
      this.spawnEnemy("boss", new THREE.Vector3(0, 0, -18));
      this.soundManager.playMonsterRoar(true);
    }

    // Dynamic wave spawning
    if (this.spawnTimer >= this.spawnInterval && this.enemies.length < this.maxEnemies && timeRemaining > 0) {
      this.spawnTimer = 0;
      this.spawnInterval = Math.max(0.9, 2.5 - ((90 - timeRemaining) / 90) * 1.5); // Accelerates over time

      // Pick spawn location along room perimeter (containment room bounds: 22m x 22m)
      const angle = Math.random() * Math.PI * 2;
      const dist = 14 + Math.random() * 4;
      const spawnX = Math.cos(angle) * dist;
      const spawnZ = Math.sin(angle) * dist;

      const rand = Math.random();
      let type: EnemyType = "grunt";
      if (rand > 0.75) type = "sniper";
      else if (rand > 0.45) type = "phantom";

      this.spawnEnemy(type, new THREE.Vector3(spawnX, 0, spawnZ));
    }

    // Update enemy AI & animations
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!;
      if (!e.isAlive) continue;

      e.animationTimer += delta * 6;

      // Vector towards player
      const dirX = playerPos.x - e.position.x;
      const dirZ = playerPos.z - e.position.z;
      const distToPlayer = Math.sqrt(dirX * dirX + dirZ * dirZ);

      // Rotate towards player
      if (distToPlayer > 0.1) {
        const targetAngle = Math.atan2(dirX, dirZ);
        e.meshGroup.rotation.y = targetAngle;

        // Move towards player
        const normX = dirX / distToPlayer;
        const normZ = dirZ / distToPlayer;

        // Phantom teleportation jitter
        if (e.type === "phantom") {
          if (Math.sin(e.animationTimer * 0.5) > 0.8) {
            e.meshGroup.visible = false;
          } else {
            e.meshGroup.visible = true;
          }
        }

        e.position.x += normX * e.speed * delta;
        e.position.z += normZ * e.speed * delta;
        e.meshGroup.position.set(e.position.x, e.position.y, e.position.z);

        // Walking sway animation
        e.meshGroup.position.y = (e.type === "boss" ? 0 : 0) + Math.abs(Math.sin(e.animationTimer)) * 0.15;
      }

      // Attack player if within reach
      const attackDist = e.type === "boss" ? 2.8 : 1.3;
      if (distToPlayer < attackDist) {
        playerDamaged += e.damage * delta;
        this.soundManager.playPlayerHurt();
      }
    }

    return { playerDamaged, hitsLanded: 0 };
  }

  public spawnEnemy(type: EnemyType, pos: THREE.Vector3) {
    const group = new THREE.Group();
    group.position.copy(pos);

    // Alien / Demogorgon fleshy materials
    const skinMat = new THREE.MeshStandardMaterial({
      color: type === "boss" ? 0x240608 : type === "phantom" ? 0x090d14 : 0x1f1619,
      roughness: 0.4,
      metalness: 0.3,
    });
    const fleshMat = new THREE.MeshStandardMaterial({
      color: 0x8a1c27,
      emissive: 0x540b13,
      emissiveIntensity: 0.6,
      roughness: 0.2,
    });
    const eyeMat = new THREE.MeshBasicMaterial({
      color: type === "boss" ? 0xff0040 : type === "phantom" ? 0x7d8cff : 0xffaa00,
    });

    const scale = type === "boss" ? 2.8 : type === "grunt" ? 1.0 : type === "phantom" ? 1.2 : 0.9;

    // Torso / Body
    const bodyGeo = new THREE.CylinderGeometry(0.25 * scale, 0.4 * scale, 1.2 * scale, 8);
    const body = new THREE.Mesh(bodyGeo, skinMat);
    body.position.y = 1.0 * scale;
    group.add(body);

    // Stranger Things iconic 5-petal flower head
    const headCore = new THREE.Mesh(new THREE.SphereGeometry(0.22 * scale, 8, 8), fleshMat);
    headCore.position.set(0, 1.7 * scale, 0.1 * scale);
    group.add(headCore);

    // 5 Petal flaps
    for (let p = 0; p < 5; p++) {
      const petalAngle = (p / 5) * Math.PI * 2;
      const petalGeo = new THREE.ConeGeometry(0.12 * scale, 0.45 * scale, 4);
      const petal = new THREE.Mesh(petalGeo, fleshMat);
      petal.position.set(
        Math.cos(petalAngle) * 0.22 * scale,
        1.7 * scale + Math.sin(petalAngle) * 0.22 * scale,
        0.25 * scale
      );
      petal.rotation.x = Math.PI / 2;
      petal.rotation.z = petalAngle;
      group.add(petal);
    }

    // Glowing eyes/maw
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08 * scale, 6, 6), eyeMat);
    eye.position.set(0, 1.7 * scale, 0.28 * scale);
    group.add(eye);

    // Elongated demonic claws / arms
    const armGeo = new THREE.CylinderGeometry(0.06 * scale, 0.04 * scale, 1.0 * scale, 6);
    const leftArm = new THREE.Mesh(armGeo, skinMat);
    leftArm.position.set(-0.4 * scale, 1.1 * scale, 0.2 * scale);
    leftArm.rotation.x = 0.5;
    leftArm.rotation.z = 0.3;

    const rightArm = leftArm.clone();
    rightArm.position.x = 0.4 * scale;
    rightArm.rotation.z = -0.3;
    group.add(leftArm, rightArm);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.08 * scale, 0.05 * scale, 1.0 * scale, 6);
    const leftLeg = new THREE.Mesh(legGeo, skinMat);
    leftLeg.position.set(-0.25 * scale, 0.45 * scale, 0);
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.25 * scale;
    group.add(leftLeg, rightLeg);

    let maxHealth = 60;
    let speed = 4.2;
    let damage = 25;

    if (type === "phantom") {
      maxHealth = 90;
      speed = 5.2;
      damage = 35;
    } else if (type === "sniper") {
      maxHealth = 110;
      speed = 2.8;
      damage = 40;
    } else if (type === "boss") {
      maxHealth = 850;
      speed = 3.6;
      damage = 65;
    }

    const enemy: EnemyInstance = {
      id: Math.random().toString(36).slice(2, 9),
      type,
      health: maxHealth,
      maxHealth,
      speed,
      position: { x: pos.x, y: 0, z: pos.z },
      velocity: { x: 0, y: 0, z: 0 },
      scale,
      damage,
      points: ENEMY_POINTS[type as keyof typeof ENEMY_POINTS],
      isAlive: true,
      meshGroup: group,
      animationTimer: Math.random() * 10,
      phaseOffset: Math.random() * Math.PI,
    };

    this.enemies.push(enemy);
    this.enemiesGroup.add(group);
  }

  public takeDamage(enemyId: string, damage: number): { killed: boolean; enemy: EnemyInstance | null } {
    const enemy = this.enemies.find((e) => e.id === enemyId);
    if (!enemy || !enemy.isAlive) return { killed: false, enemy: null };

    enemy.health -= damage;
    this.soundManager.playMonsterHit();

    // Damage flash red
    enemy.meshGroup.traverse((child: any) => {
      if (child.isMesh && child.material) {
        child.material.emissive?.setHex(0xffffff);
        setTimeout(() => {
          if (child && child.material && child.material.emissive) {
            child.material.emissive.setHex(0x540b13);
          }
        }, 60);
      }
    });

    if (enemy.health <= 0) {
      enemy.isAlive = false;
      this.soundManager.playMonsterRoar(enemy.type === "boss");
      this.enemiesGroup.remove(enemy.meshGroup);
      return { killed: true, enemy };
    }

    return { killed: false, enemy };
  }

  public reset() {
    for (const e of this.enemies) {
      this.enemiesGroup.remove(e.meshGroup);
    }
    this.enemies = [];
    this.bossSpawned = false;
    this.spawnTimer = 0;
  }
}
