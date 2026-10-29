"use client";

import React from "react";
import type { GameStats, WeaponDef, WeaponType } from "@/game/types";

interface GameHUDProps {
  stats: GameStats;
  currentWeapon: WeaponDef;
  weapons: Record<WeaponType, WeaponDef>;
  autoReloadProgress: number;
  playerHealth: number;
  notification: string | null;
  hitActive: boolean;
  onSelectWeapon: (type: WeaponType) => void;
}

export function GameHUD({
  stats,
  currentWeapon,
  weapons,
  autoReloadProgress,
  playerHealth,
  notification,
  hitActive,
  onSelectWeapon,
}: GameHUDProps) {
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const isLowHealth = playerHealth < 30;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", userSelect: "none" }}>
      {/* Damage vignette */}
      {isLowHealth && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow: "inset 0 0 120px rgba(229, 88, 74, 0.45)",
            animation: "pulse 1.2s infinite ease-in-out",
          }}
        />
      )}

      {/* Hit Marker in center */}
      {hitActive && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "28px",
            height: "28px",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              width: "100%",
              height: "2px",
              background: "#ff3f70",
              transform: "rotate(45deg)",
              top: "13px",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: "100%",
              height: "2px",
              background: "#ff3f70",
              transform: "rotate(-45deg)",
              top: "13px",
            }}
          />
        </div>
      )}

      {/* Center Reticle */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "14px",
          height: "14px",
          border: `2px solid ${currentWeapon.color}`,
          borderRadius: "50%",
          opacity: 0.85,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "3px",
            height: "3px",
            backgroundColor: "#ffffff",
            borderRadius: "50%",
          }}
        />
      </div>

      {/* Top Bar: Match Timer & Boss Alert */}
      <div
        style={{
          position: "absolute",
          top: "24px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <div
          style={{
            background: "rgba(17, 20, 24, 0.85)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "12px",
            padding: "8px 24px",
            backdropFilter: "blur(8px)",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "2rem",
              fontWeight: 700,
              color: stats.timeRemaining < 20 ? "#ff3f70" : "#e8ecf1",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatTime(stats.timeRemaining)}
          </span>
        </div>

        {stats.bossSpawned && (
          <div
            style={{
              background: "rgba(229, 88, 74, 0.9)",
              color: "#ffffff",
              padding: "4px 16px",
              borderRadius: "6px",
              fontFamily: "var(--font-display, sans-serif)",
              fontSize: "0.9rem",
              letterSpacing: "0.15em",
              fontWeight: 700,
              animation: "pulse 0.8s infinite",
            }}
          >
            ⚠️ APEX DEMOGORGON ENGAGED
          </div>
        )}
      </div>

      {/* Top Left: Score, Multiplier, Streak */}
      <div
        style={{
          position: "absolute",
          top: "24px",
          left: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div
          style={{
            background: "rgba(17, 20, 24, 0.85)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "12px",
            padding: "16px 20px",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#a3adba", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Score
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "2.2rem",
              fontWeight: 700,
              color: "#3fd6c0",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {stats.score.toLocaleString()}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}>
            <span
              style={{
                background: stats.multiplier === 3 ? "#3fd6c0" : stats.multiplier === 2 ? "#f2a43a" : "rgba(255,255,255,0.1)",
                color: "#0b0d10",
                fontWeight: 700,
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: "4px",
              }}
            >
              {stats.multiplier}X MULTIPLIER
            </span>
            <span style={{ fontSize: "0.8rem", color: "#a3adba", fontFamily: "var(--font-mono, monospace)" }}>
              KILLS: {stats.kills}
            </span>
            <span style={{ fontSize: "0.8rem", color: "#a3adba", fontFamily: "var(--font-mono, monospace)" }}>
              ACC: {stats.accuracy}%
            </span>
          </div>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div
          style={{
            position: "absolute",
            top: "100px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(63, 214, 192, 0.95)",
            color: "#0b0d10",
            padding: "10px 24px",
            borderRadius: "8px",
            fontWeight: 700,
            fontSize: "0.95rem",
            letterSpacing: "0.08em",
            boxShadow: "0 8px 30px rgba(63, 214, 192, 0.4)",
            animation: "slideDown 0.3s ease-out",
          }}
        >
          {notification}
        </div>
      )}

      {/* Bottom Left: Health Bar */}
      <div
        style={{
          position: "absolute",
          bottom: "28px",
          left: "28px",
          width: "260px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#a3adba" }}>
          <span>VITALS</span>
          <span style={{ fontFamily: "var(--font-mono, monospace)", color: isLowHealth ? "#ff3f70" : "#3fd6c0" }}>
            {Math.round(playerHealth)}%
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: "10px",
            background: "rgba(255, 255, 255, 0.1)",
            borderRadius: "5px",
            overflow: "hidden",
            border: "1px solid rgba(255, 255, 255, 0.15)",
          }}
        >
          <div
            style={{
              width: `${Math.max(0, playerHealth)}%`,
              height: "100%",
              background: isLowHealth ? "#e5584a" : "#3fd6c0",
              transition: "width 0.2s ease-out",
            }}
          />
        </div>
      </div>

      {/* Bottom Right: Active Gun & Auto-Reload */}
      <div
        style={{
          position: "absolute",
          bottom: "28px",
          right: "28px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "12px",
        }}
      >
        {/* Weapon Arsenal Quick Select */}
        <div style={{ display: "flex", gap: "8px", pointerEvents: "auto" }}>
          {(["pistol", "shotgun", "rifle", "plasma"] as WeaponType[]).map((type, idx) => {
            const w = weapons[type];
            const isSelected = w.id === currentWeapon.id;
            return (
              <button
                key={type}
                onClick={() => onSelectWeapon(type)}
                disabled={!w.unlocked}
                style={{
                  background: isSelected ? w.color : "rgba(17, 20, 24, 0.8)",
                  color: isSelected ? "#0b0d10" : w.unlocked ? "#e8ecf1" : "#6b7685",
                  border: isSelected ? `2px solid #ffffff` : "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  padding: "6px 12px",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.8rem",
                  cursor: w.unlocked ? "pointer" : "not-allowed",
                  opacity: w.unlocked ? 1 : 0.4,
                  transition: "all 0.15s ease",
                }}
              >
                [{idx + 1}] {w.name}
              </button>
            );
          })}
        </div>

        {/* Ammo & Auto-Reload Status */}
        <div
          style={{
            background: "rgba(17, 20, 24, 0.9)",
            border: `1px solid ${currentWeapon.color}`,
            borderRadius: "14px",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            gap: "20px",
            backdropFilter: "blur(8px)",
          }}
        >
          <div>
            <div style={{ fontSize: "0.75rem", color: "#a3adba", textTransform: "uppercase" }}>
              {currentWeapon.category}
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: currentWeapon.color }}>
              {currentWeapon.name}
            </div>
          </div>

          {/* Ammo display */}
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "2.4rem",
                fontWeight: 700,
                color: currentWeapon.currentAmmo === 0 ? "#ff3f70" : "#e8ecf1",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {currentWeapon.currentAmmo}
              <span style={{ fontSize: "1.2rem", color: "#6b7685" }}>/{currentWeapon.maxAmmo}</span>
            </div>
            <div style={{ fontSize: "0.7rem", color: "#a3adba", fontFamily: "var(--font-mono, monospace)" }}>
              {currentWeapon.currentAmmo < currentWeapon.maxAmmo
                ? `AUTO-RELOADING (${Math.round(autoReloadProgress * 100)}%)`
                : "MAGAZINE FULL"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
