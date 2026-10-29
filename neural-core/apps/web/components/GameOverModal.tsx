"use client";

import React from "react";
import type { GameStats } from "@/game/types";

interface GameOverModalProps {
  stats: GameStats;
  onRestart: () => void;
}

export function GameOverModal({ stats, onRestart }: GameOverModalProps) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(11, 13, 16, 0.88)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        userSelect: "none",
      }}
    >
      <div
        style={{
          background: "var(--bg-1, #111418)",
          border: `1px solid ${stats.isVictory ? "var(--focus, #3fd6c0)" : "var(--alert, #e5584a)"}`,
          borderRadius: "16px",
          padding: "40px",
          width: "90%",
          maxWidth: "520px",
          textAlign: "center",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.8)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display, sans-serif)",
            fontSize: "2.8rem",
            color: stats.isVictory ? "#3fd6c0" : "#e5584a",
            letterSpacing: "0.08em",
            marginBottom: "8px",
          }}
        >
          {stats.isVictory ? "SURVIVED THE CONTAINMENT" : "CONTAINMENT BREACHED"}
        </h2>

        <p style={{ color: "#a3adba", fontSize: "1rem", marginBottom: "32px" }}>
          {stats.isVictory
            ? "You held off the Demogorgon horde for the full 90 seconds."
            : "The entities from the Upside Down overpowered you."}
        </p>

        {/* Stats Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "36px",
          }}
        >
          <div style={{ background: "#171b21", padding: "16px", borderRadius: "10px" }}>
            <div style={{ fontSize: "0.75rem", color: "#6b7685", textTransform: "uppercase" }}>Final Score</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "1.8rem", color: "#3fd6c0", fontWeight: 700 }}>
              {stats.score.toLocaleString()}
            </div>
          </div>

          <div style={{ background: "#171b21", padding: "16px", borderRadius: "10px" }}>
            <div style={{ fontSize: "0.75rem", color: "#6b7685", textTransform: "uppercase" }}>Entities Destroyed</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "1.8rem", color: "#e8ecf1", fontWeight: 700 }}>
              {stats.kills}
            </div>
          </div>

          <div style={{ background: "#171b21", padding: "16px", borderRadius: "10px" }}>
            <div style={{ fontSize: "0.75rem", color: "#6b7685", textTransform: "uppercase" }}>Accuracy</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "1.8rem", color: "#e8ecf1", fontWeight: 700 }}>
              {stats.accuracy}%
            </div>
          </div>

          <div style={{ background: "#171b21", padding: "16px", borderRadius: "10px" }}>
            <div style={{ fontSize: "0.75rem", color: "#6b7685", textTransform: "uppercase" }}>Peak Streak</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "1.8rem", color: "#f2a43a", fontWeight: 700 }}>
              {stats.comboStreak}
            </div>
          </div>
        </div>

        <button
          onClick={onRestart}
          style={{
            background: "#3fd6c0",
            color: "#0b0d10",
            border: "none",
            borderRadius: "10px",
            padding: "16px 36px",
            fontSize: "1.1rem",
            fontWeight: 700,
            cursor: "pointer",
            width: "100%",
            letterSpacing: "0.05em",
            boxShadow: "0 4px 20px rgba(63, 214, 192, 0.4)",
          }}
        >
          RE-ENTER CONTAINMENT
        </button>
      </div>
    </div>
  );
}
