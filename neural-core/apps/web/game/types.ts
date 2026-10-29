import type { EnemyType } from "@neural-core/shared";
export type { EnemyType };

export type WeaponType = "pistol" | "shotgun" | "rifle" | "plasma";

export interface WeaponDef {
  id: WeaponType;
  name: string;
  category: string;
  maxAmmo: number;
  currentAmmo: number;
  fireRate: number;      // Seconds between shots
  damage: number;
  pellets: number;
  spread: number;
  recoil: number;
  autoReloadTime: number;// Seconds of idle before auto-reload completes
  color: string;
  unlocked: boolean;
}

export interface EnemyInstance {
  id: string;
  type: EnemyType;
  health: number;
  maxHealth: number;
  speed: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  scale: number;
  damage: number;
  points: number;
  isAlive: boolean;
  meshGroup: any; // THREE.Group
  animationTimer: number;
  phaseOffset: number;
}

export interface BulletInstance {
  id: string;
  origin: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  speed: number;
  damage: number;
  distanceTraveled: number;
  maxDistance: number;
  color: string;
  weaponType: WeaponType;
}

export interface WeaponPickup {
  id: string;
  weaponType: WeaponType;
  position: { x: number; y: number; z: number };
  meshGroup: any;
  collected: boolean;
}

export interface GameStats {
  score: number;
  multiplier: number;
  comboStreak: number;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  accuracy: number;
  timeRemaining: number;
  isGameOver: boolean;
  isVictory: boolean;
  bossSpawned: boolean;
}
