import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const commandText = "Write a crisp launch update for the team.";
const pastedText =
  "Launch update: We shipped the new Vorn Voice settings UI with light/dark themes, improved speech analytics, and smoother onboarding. Next we are finalizing packaging and web demo assets for release.";

function reveal(text: string, frame: number, start: number, charsPerFrame: number): string {
  const len = Math.max(0, Math.floor((frame - start) * charsPerFrame));
  return text.slice(0, len);
}

export const DemoVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const commandIn = reveal(commandText, frame, 8, 2.2);

  const toMenu = interpolate(frame, [56, 96], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic)
  });
  const toCenter = interpolate(frame, [118, 160], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic)
  });

  const camScale = 1 + toMenu * 1.75 - toCenter * 1.38;
  const camX = -300 * toMenu + 300 * toCenter;
  const camY = -230 * toMenu + 190 * toCenter;

  const focusRing = interpolate(frame, [78, 94, 112], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  const overlayPop = spring({
    frame: frame - 150,
    fps,
    config: { damping: 14, stiffness: 170, mass: 0.84 }
  });
  const overlayOpacity = interpolate(frame, [148, 162], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  const status: "listening" | "transcribing" = frame < 196 ? "listening" : "transcribing";
  const menuStatus = frame < 88 ? "Idle" : status === "listening" ? "Listening" : "Transcribing";

  const pasteIn = reveal(pastedText, frame, 204, 2.5);
  const cursorVisible = frame % 22 < 11;

  const pulse = interpolate(Math.sin(frame / 5.2), [-1, 1], [0.74, 1]);

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(1300px 850px at 0% 0%, #4f83ff2f, transparent 60%), radial-gradient(1000px 700px at 100% 100%, #29c5bc2f, transparent 56%), #070b13",
        fontFamily: "SF Pro Text, -apple-system, BlinkMacSystemFont, Helvetica Neue, sans-serif",
        color: "#edf4ff"
      }}
    >
      <AbsoluteFill
        style={{
          opacity: 0.06,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "76px 76px"
        }}
      />

      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 1640,
            height: 940,
            borderRadius: 22,
            overflow: "hidden",
            position: "relative",
            border: "1px solid rgba(255,255,255,0.12)",
            background: "linear-gradient(180deg, rgba(18,23,35,0.98), rgba(12,17,27,0.97))",
            boxShadow: "0 34px 96px rgba(0,0,0,0.52)",
            transform: `translate(${camX}px, ${camY}px) scale(${camScale})`
          }}
        >
          <div
            style={{
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 16px",
              background: "linear-gradient(180deg, #607f8f, #4b6d7d)",
              borderBottom: "1px solid rgba(255,255,255,0.14)",
              fontSize: 16
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: status === "transcribing" ? "#9ab6ff" : "#4fd7bf",
                  boxShadow: `0 0 0 6px rgba(79,215,191,${0.18 * pulse})`
                }}
              />
              <span style={{ fontWeight: 600 }}>Vorn Voice</span>
              <span style={{ color: "#d5e8ee" }}>{menuStatus}</span>
            </div>
            <div style={{ display: "flex", gap: 14, color: "#d7e8ed" }}>
              <span>CPU 34%</span>
              <span>GPU 13%</span>
              <span>SSD 61%</span>
            </div>
          </div>

          <div style={{ position: "absolute", top: 36, left: 0, right: 0, bottom: 0, background: "#141c29" }} />

          <div
            style={{
              position: "absolute",
              top: 36,
              left: 0,
              bottom: 0,
              width: 320,
              borderRight: "1px solid rgba(255,255,255,0.09)",
              background: "#1b2534",
              padding: "16px 14px"
            }}
          >
            <div style={{ fontSize: 12, color: "#8fa5c1", textTransform: "uppercase", letterSpacing: "0.09em" }}>Folders</div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
              {["Quick Notes", "Ideas", "Ops", "Launch"].map((item, idx) => (
                <div
                  key={item}
                  style={{
                    fontSize: 16,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: idx === 0 ? "rgba(93,141,253,0.3)" : "transparent",
                    color: idx === 0 ? "#e2eeff" : "#9fb2ce"
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div style={{ position: "absolute", top: 36, left: 320, right: 0, bottom: 0, padding: "28px 34px", background: "#0f1623" }}>
            <div style={{ fontSize: 36, fontWeight: 600, color: "#f3f7ff" }}>Quick Notes</div>
            <div style={{ marginTop: 8, fontSize: 16, color: "#8fa3c5" }}>Today 4:21 PM</div>

            <div
              style={{
                marginTop: 18,
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(31,41,58,0.74)",
                maxWidth: 1040
              }}
            >
              <div style={{ fontSize: 14, color: "#95aace", marginBottom: 8 }}>Command</div>
              <div style={{ fontSize: 28, lineHeight: 1.3, color: "#f4f8ff" }}>
                {commandIn}
                <span style={{ opacity: cursorVisible && frame < 150 ? 1 : 0 }}>|</span>
              </div>
            </div>

            {frame >= 206 ? (
              <div
                style={{
                  marginTop: 20,
                  padding: "16px 18px",
                  borderRadius: 12,
                  border: "1px solid rgba(118,170,255,0.35)",
                  background: "rgba(72,113,184,0.19)",
                  maxWidth: 1100
                }}
              >
                <div style={{ fontSize: 14, color: "#a3bae6", marginBottom: 8 }}>Inserted text</div>
                <div style={{ fontSize: 29, lineHeight: 1.34, letterSpacing: "-0.01em", color: "#e8f0ff" }}>{pasteIn}</div>
              </div>
            ) : null}
          </div>

          <div
            style={{
              position: "absolute",
              left: 10,
              top: 5,
              width: 206,
              height: 26,
              borderRadius: 12,
              border: "2px solid rgba(88, 230, 210, 0.88)",
              boxShadow: "0 0 0 6px rgba(88,230,210,0.24)",
              opacity: focusRing
            }}
          />

          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "54%",
              transform: `translate(-50%, -50%) scale(${overlayPop})`,
              opacity: overlayOpacity,
              width: 340,
              height: 72,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(22,28,35,0.9)",
              boxShadow: "0 12px 26px rgba(0,0,0,0.34)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 18px"
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: status === "transcribing" ? "#9ab6ff" : "#4fd7bf",
                boxShadow:
                  status === "transcribing"
                    ? "0 0 0 8px rgba(154,182,255,0.24)"
                    : `0 0 0 8px rgba(79,215,191,${0.26 * pulse})`
              }}
            />
            <div style={{ margin: 0, color: "#f9fdff", fontSize: 36, fontWeight: 700, letterSpacing: "-0.01em" }}>
              {status === "transcribing" ? "Transcribing..." : "Listening..."}
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 18,
              transform: "translateX(-50%)",
              width: 760,
              height: 62,
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.13)",
              background: "rgba(44,56,74,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12
            }}
          >
            {["F", "N", "T", "B", "V"].map((label, idx) => (
              <div
                key={label}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: idx === 1 ? "linear-gradient(180deg, #69a0ff, #3f71d9)" : "rgba(255,255,255,0.14)",
                  color: "#edf3ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
