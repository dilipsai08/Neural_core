"use client";

import React, { useEffect, useRef, useState } from "react";
import { GameEngine } from "@/game/GameEngine";
import { GameHUD } from "@/components/GameHUD";
import { GameOverModal } from "@/components/GameOverModal";
import type { GameStats, WeaponType, WeaponDef } from "@/game/types";

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [isLocked, setIsLocked] = useState(false);
  const [stats, setStats] = useState<GameStats>({
    score: 0,
    multiplier: 1,
    comboStreak: 0,
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    accuracy: 100,
    timeRemaining: 90,
    isGameOver: false,
    isVictory: false,
    bossSpawned: false,
  });

  const [currentWeapon, setCurrentWeapon] = useState<WeaponDef>({
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
  });

  const [weapons, setWeapons] = useState<Record<WeaponType, WeaponDef>>({} as any);
  const [autoReloadProgress, setAutoReloadProgress] = useState(1);
  const [playerHealth, setPlayerHealth] = useState(100);
  const [notification, setNotification] = useState<string | null>(null);
  const [hitActive, setHitActive] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new GameEngine(canvasRef.current);
    engineRef.current = engine;
    setWeapons({ ...engine.weapons.weapons });
    setCurrentWeapon({ ...engine.weapons.currentWeapon });

    engine.onStatsUpdate = (newStats) => {
      setStats({ ...newStats });
      setCurrentWeapon({ ...engine.weapons.currentWeapon });
      setWeapons({ ...engine.weapons.weapons });
      setAutoReloadProgress(engine.weapons.getAutoReloadProgress());
      setPlayerHealth(engine.player.health);
    };

    engine.onHitFeedback = () => {
      setHitActive(true);
      setTimeout(() => setHitActive(false), 90);
    };

    engine.onWeaponUnlocked = (msg) => {
      setNotification(msg);
      setTimeout(() => setNotification(null), 3500);
    };

    engine.onGameOver = (finalStats) => {
      setStats({ ...finalStats });
      document.exitPointerLock?.();
    };

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === canvasRef.current;
      setIsLocked(locked);
      engine.player.isLocked = locked;
    };

    document.addEventListener("pointerlockchange", handlePointerLockChange);

    // Keyboard quick weapon switch (1, 2, 3, 4)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Digit1") engine.weapons.selectWeapon("pistol");
      if (e.code === "Digit2") engine.weapons.selectWeapon("shotgun");
      if (e.code === "Digit3") engine.weapons.selectWeapon("rifle");
      if (e.code === "Digit4") engine.weapons.selectWeapon("plasma");
    };

    // Mouse click shooting
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && document.pointerLockElement === canvasRef.current) {
        engine.fireCurrentWeapon();
      }
    };

    // Scroll wheel weapon cycling
    const handleWheel = () => {
      engine.weapons.switchNextWeapon();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("wheel", handleWheel);

    return () => {
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("wheel", handleWheel);
      engine.destroy();
    };
  }, []);

  const handleCanvasClick = () => {
    if (!canvasRef.current || stats.isGameOver) return;
    canvasRef.current.requestPointerLock();
    if (engineRef.current) {
      engineRef.current.start();
    }
  };

  const handleSelectWeapon = (type: WeaponType) => {
    if (engineRef.current) {
      engineRef.current.weapons.selectWeapon(type);
      setCurrentWeapon({ ...engineRef.current.weapons.currentWeapon });
    }
  };

  const handleRestart = () => {
    if (engineRef.current) {
      engineRef.current.restart();
      canvasRef.current?.requestPointerLock();
    }
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#0b0d10" }}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ width: "100%", height: "100%", display: "block", cursor: isLocked ? "none" : "pointer" }}
      />

      {/* In-Game HUD */}
      {isLocked && !stats.isGameOver && Object.keys(weapons).length > 0 && (
        <GameHUD
          stats={stats}
          currentWeapon={currentWeapon}
          weapons={weapons}
          autoReloadProgress={autoReloadProgress}
          playerHealth={playerHealth}
          notification={notification}
          hitActive={hitActive}
          onSelectWeapon={handleSelectWeapon}
        />
      )}

      {/* Start / Pause Overlay */}
      {!isLocked && !stats.isGameOver && (
        <div
          onClick={handleCanvasClick}
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at center, rgba(11, 13, 16, 0.75) 0%, rgba(7, 9, 14, 0.95) 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div
            style={{
              background: "#111418",
              border: "1px solid rgba(63, 214, 192, 0.3)",
              borderRadius: "20px",
              padding: "48px 56px",
              textAlign: "center",
              maxWidth: "600px",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.7)",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-display, sans-serif)",
                fontSize: "3.2rem",
                color: "#e8ecf1",
                letterSpacing: "0.08em",
                lineHeight: 1.1,
                marginBottom: "12px",
              }}
            >
              CONTAINMENT <span style={{ color: "#3fd6c0" }}>PROTOCOL</span>
            </h1>

            <p style={{ color: "#a3adba", fontSize: "1.1rem", marginBottom: "32px", lineHeight: 1.6 }}>
              You are sealed inside the Hawkins containment bunker. The Upside Down has breached the walls.
              Survive the incoming Demogorgon entities for 90 seconds.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                textAlign: "left",
                background: "#171b21",
                borderRadius: "12px",
                padding: "20px",
                marginBottom: "36px",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "0.85rem",
                color: "#a3adba",
              }}
            >
              <div><strong style={{ color: "#3fd6c0" }}>[W, A, S, D]</strong> Move Around</div>
              <div><strong style={{ color: "#3fd6c0" }}>[MOUSE]</strong> Look & Aim</div>
              <div><strong style={{ color: "#3fd6c0" }}>[CLICK]</strong> Fire Weapon</div>
              <div><strong style={{ color: "#3fd6c0" }}>[1, 2, 3, 4]</strong> Switch Guns</div>
              <div><strong style={{ color: "#f2a43a" }}>[IDLE]</strong> Auto-Reloads Ammo</div>
              <div><strong style={{ color: "#ff3f70" }}>[CRATES]</strong> Unlock New Guns</div>
            </div>

            <button
              style={{
                background: "#3fd6c0",
                color: "#0b0d10",
                border: "none",
                borderRadius: "10px",
                padding: "16px 40px",
                fontSize: "1.2rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                boxShadow: "0 4px 25px rgba(63, 214, 192, 0.4)",
              }}
            >
              CLICK TO ENTER BUNKER
            </button>
          </div>
        </div>
      )}

      {/* Game Over / Victory Modal */}
      {stats.isGameOver && <GameOverModal stats={stats} onRestart={handleRestart} />}
    </div>
  );
}
