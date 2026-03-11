import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const shortcut = ["Shift", "Command", "R"];
const onboardingSteps = ["Choose your model", "Enable access", "Pick how dictation feels", "Test and finish"];
const verificationTranscript = "This shortcut run worked and the transcript looks clean, local, and ready to use.";
const waveformBars = [0.22, 0.46, 0.34, 0.68, 0.4, 0.75, 0.36, 0.82, 0.44, 0.58, 0.32, 0.64];

type DemoMode = "armed" | "listening" | "transcribing" | "passed";
type OverlayMode = "listening" | "transcribing" | "message";

function reveal(text: string, frame: number, start: number, charsPerFrame: number): string {
  const length = Math.max(0, Math.floor((frame - start) * charsPerFrame));
  return text.slice(0, length);
}

function ease(frame: number, input: [number, number], output: [number, number]): number {
  return interpolate(frame, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic)
  });
}

function verificationStatusLabel(mode: DemoMode): string {
  switch (mode) {
    case "listening":
      return "Listening";
    case "transcribing":
      return "Transcribing";
    case "passed":
      return "Passed";
    default:
      return "Waiting for shortcut";
  }
}

function verificationInstructions(mode: DemoMode): string {
  switch (mode) {
    case "listening":
      return "Listening now. Speak naturally, then finish with the same shortcut behavior you chose.";
    case "transcribing":
      return "Transcribing your verification phrase now.";
    case "passed":
      return "That shortcut run worked. Review the transcript below, then finish setup.";
    default:
      return "Use Shift + Command + R exactly the way you plan to dictate every day.";
  }
}

function overlayCopy(mode: OverlayMode): { kicker: string; text: string } {
  if (mode === "listening") {
    return { kicker: "Listening", text: "Waiting for speech..." };
  }

  if (mode === "transcribing") {
    return { kicker: "Transcribing", text: "Turning your voice into text..." };
  }

  return { kicker: "Ready", text: "Transcript delivered" };
}

function overlayTone(mode: OverlayMode): { border: string; dot: string; ring: string } {
  if (mode === "listening") {
    return {
      border: "rgba(85, 213, 199, 0.24)",
      dot: "#4fd7bf",
      ring: "rgba(79, 215, 191, 0.7)"
    };
  }

  if (mode === "transcribing") {
    return {
      border: "rgba(115, 163, 255, 0.24)",
      dot: "#73a3ff",
      ring: "rgba(115, 163, 255, 0.5)"
    };
  }

  return {
    border: "rgba(255, 255, 255, 0.12)",
    dot: "#bcd2ce",
    ring: "rgba(255, 255, 255, 0)"
  };
}

const Keycap: React.FC<{ label: string; active: boolean }> = ({ label, active }) => {
  return (
    <div
      style={{
        minWidth: 74,
        padding: "10px 14px",
        borderRadius: 14,
        border: active ? "1px solid rgba(249,115,22,0.38)" : "1px solid rgba(255,255,255,0.08)",
        background: active ? "rgba(249,115,22,0.14)" : "rgba(17,17,17,0.96)",
        color: active ? "#ffd7b5" : "#f5f5f5",
        fontSize: 20,
        fontWeight: 700,
        textAlign: "center",
        boxShadow: active ? "0 12px 24px rgba(249,115,22,0.16)" : "none"
      }}
    >
      {label}
    </div>
  );
};

const SidebarStep: React.FC<{ label: string; index: number; active: boolean }> = ({ label, index, active }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 20,
        border: active ? "1px solid rgba(249,115,22,0.22)" : "1px solid rgba(255,255,255,0.06)",
        background: active ? "rgba(249,115,22,0.08)" : "rgba(17,17,17,0.7)"
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          background: active ? "rgba(249,115,22,0.2)" : "rgba(255,255,255,0.06)",
          color: active ? "#ffd7b5" : "#a1a1aa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          fontWeight: 700
        }}
      >
        0{index + 1}
      </div>
      <div style={{ fontSize: 20, fontWeight: active ? 700 : 600, color: active ? "#f5f5f5" : "#d4d4d8" }}>{label}</div>
    </div>
  );
};

const MetaBadge: React.FC<{ label: string; tone?: "neutral" | "success" | "warm" }> = ({ label, tone = "neutral" }) => {
  const colors = tone === "success"
    ? {
        background: "rgba(5, 150, 105, 0.18)",
        border: "1px solid rgba(16, 185, 129, 0.24)",
        color: "#d1fae5"
      }
    : tone === "warm"
      ? {
          background: "rgba(249,115,22,0.12)",
          border: "1px solid rgba(249,115,22,0.22)",
          color: "#ffd7b5"
        }
      : {
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.06)",
          color: "#a1a1aa"
        };

  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 999,
        background: colors.background,
        border: colors.border,
        color: colors.color,
        fontSize: 15,
        fontWeight: 700
      }}
    >
      {label}
    </div>
  );
};

export const DemoVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const shellIn = spring({
    frame: frame - 2,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.95 }
  });
  const sidebarIn = spring({
    frame: frame - 8,
    fps,
    config: { damping: 16, stiffness: 135, mass: 0.92 }
  });
  const mainIn = spring({
    frame: frame - 14,
    fps,
    config: { damping: 16, stiffness: 145, mass: 0.9 }
  });
  const transcriptIn = spring({
    frame: frame - 156,
    fps,
    config: { damping: 15, stiffness: 170, mass: 0.88 }
  });

  const mode: DemoMode = frame < 42 ? "armed" : frame < 112 ? "listening" : frame < 152 ? "transcribing" : "passed";
  const overlayMode: OverlayMode | null = frame < 42 ? null : frame < 112 ? "listening" : frame < 152 ? "transcribing" : "message";
  const overlayVisible = frame >= 42;
  const activeShortcut = mode === "listening" || mode === "transcribing";
  const pulse = interpolate(Math.sin(frame / 4.8), [-1, 1], [0.72, 1]);
  const driftX = ease(frame, [0, 239], [0, -8]);
  const driftY = ease(frame, [0, 239], [10, 0]);
  const overlayOpacity = ease(frame, [42, 54], [0, 1]);
  const overlayLift = ease(frame, [42, 54], [16, 0]);
  const transcriptText = reveal(verificationTranscript, frame, 162, 1.8);
  const transcriptGlow = ease(frame, [160, 214], [0, 1]);
  const finishGlow = ease(frame, [170, 224], [0, 1]);

  const overlayStyle = overlayMode ? overlayTone(overlayMode) : overlayTone("listening");
  const overlayLabels = overlayMode ? overlayCopy(overlayMode) : overlayCopy("listening");

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(1200px 760px at 14% 12%, rgba(249,115,22,0.14), transparent 58%), radial-gradient(960px 680px at 88% 18%, rgba(255,255,255,0.05), transparent 60%), #050505",
        color: "#f5f5f5",
        fontFamily: '"Satoshi", "Plus Jakarta Sans", "Avenir Next", sans-serif'
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "92px 92px",
          opacity: 0.22
        }}
      />

      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 60
        }}
      >
        <div
          style={{
            width: 1660,
            height: 900,
            borderRadius: 32,
            overflow: "hidden",
            position: "relative",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg, rgba(17,17,17,0.98), rgba(7,7,7,0.98))",
            boxShadow: "0 40px 120px rgba(0,0,0,0.48)",
            transform: `translate(${driftX}px, ${driftY}px) scale(${0.965 + shellIn * 0.035})`
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(900px 540px at 14% 18%, rgba(249,115,22,0.1), transparent 70%), linear-gradient(180deg, rgba(255,255,255,0.02), transparent 20%)"
            }}
          />

          <div
            style={{
              height: 54,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 18px 0 16px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.02)"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
                <div key={color} style={{ width: 12, height: 12, borderRadius: 999, background: color }} />
              ))}
            </div>
            <div style={{ fontSize: 15, color: "#a1a1aa", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Vorn Voice
            </div>
            <div style={{ width: 44 }} />
          </div>

          <div style={{ display: "flex", height: "calc(100% - 54px)" }}>
            <div
              style={{
                width: 404,
                padding: 28,
                borderRight: "1px solid rgba(255,255,255,0.06)",
                background: "linear-gradient(180deg, rgba(14,14,14,0.98), rgba(8,8,8,0.94))",
                transform: `translateY(${14 - sidebarIn * 14}px)`,
                opacity: sidebarIn
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 6,
                    background: "#f97316",
                    boxShadow: "0 0 0 8px rgba(249,115,22,0.14)"
                  }}
                />
                <div>
                  <div style={{ fontSize: 14, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                    Vorn Voice
                  </div>
                  <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: "#f5f5f5" }}>
                    Set up local dictation
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 26, fontSize: 48, lineHeight: 0.98, fontWeight: 700, letterSpacing: "-0.04em" }}>
                Test one live run before you leave setup.
              </div>
              <div style={{ marginTop: 16, fontSize: 22, lineHeight: 1.45, color: "#d4d4d8" }}>
                Run one live dictation before you leave setup so you know the full local pipeline works on this Mac.
              </div>

              <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 12 }}>
                {onboardingSteps.map((step, index) => (
                  <SidebarStep key={step} active={index === 3} index={index} label={step} />
                ))}
              </div>

              <div
                style={{
                  marginTop: 24,
                  padding: 20,
                  borderRadius: 24,
                  border: "1px solid rgba(255,255,255,0.07)",
                  background: "rgba(17,17,17,0.95)"
                }}
              >
                <div style={{ fontSize: 14, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  Ready now
                </div>
                <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <MetaBadge label="Model: base.en" tone="neutral" />
                  <MetaBadge label="Runtime ready" tone="neutral" />
                  <MetaBadge label="Mic granted" tone="neutral" />
                  <MetaBadge label="Paste ready" tone="warm" />
                </div>

                <div style={{ marginTop: 18, fontSize: 14, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  Hold to talk
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                  {shortcut.map((label) => (
                    <Keycap key={label} active={activeShortcut} label={label} />
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                padding: 28,
                background: "linear-gradient(180deg, rgba(10,10,10,0.98), rgba(5,5,5,0.98))",
                transform: `translateY(${16 - mainIn * 16}px)`,
                opacity: mainIn
              }}
            >
              <div
                style={{
                  padding: 24,
                  borderRadius: 28,
                  border: "1px solid rgba(255,255,255,0.07)",
                  background: "rgba(17,17,17,0.95)"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 14, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                      Status
                    </div>
                    <div style={{ marginTop: 10, fontSize: 34, lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.03em" }}>
                      Ready to dictate
                    </div>
                    <div style={{ marginTop: 10, fontSize: 20, color: "#d4d4d8", lineHeight: 1.45 }}>
                      Everything needed for a local test run is in place.
                    </div>
                  </div>
                  <MetaBadge label="Healthy" tone="warm" />
                </div>
              </div>

              <div
                style={{
                  marginTop: 20,
                  padding: 24,
                  borderRadius: 28,
                  border: "1px solid rgba(255,255,255,0.07)",
                  background: "rgba(17,17,17,0.95)"
                }}
              >
                <div>
                  <div style={{ fontSize: 14, color: "#f97316", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                    Test and finish
                  </div>
                  <div style={{ marginTop: 10, fontSize: 22, color: "#d4d4d8", lineHeight: 1.45 }}>
                    Run one live dictation before you leave setup so you know the full local pipeline works on this Mac.
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 22,
                    padding: 22,
                    borderRadius: 24,
                    border: `1px solid rgba(255,255,255,${0.07 + transcriptGlow * 0.05})`,
                    background: "rgba(10,10,10,0.76)",
                    boxShadow: transcriptGlow ? `0 24px 40px rgba(249,115,22,${0.08 * transcriptGlow})` : "none"
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>Test dictation</div>
                      <div style={{ marginTop: 10, fontSize: 19, color: "#d4d4d8", lineHeight: 1.45, maxWidth: 720 }}>
                        {verificationInstructions(mode)}
                      </div>
                    </div>
                    <MetaBadge label={verificationStatusLabel(mode)} tone={mode === "passed" ? "success" : mode === "armed" ? "neutral" : "warm"} />
                  </div>

                  <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <MetaBadge label={mode === "passed" ? "Verification passed" : "Verification required"} tone={mode === "passed" ? "success" : "warm"} />
                    <MetaBadge label="Auto-paste into my active app" tone="neutral" />
                  </div>

                  {mode === "passed" ? (
                    <div
                      style={{
                        marginTop: 20,
                        padding: 22,
                        borderRadius: 24,
                        border: "1px solid rgba(16,185,129,0.26)",
                        background: "linear-gradient(180deg, rgba(5, 80, 55, 0.28), rgba(6, 18, 13, 0.92))",
                        transform: `translateY(${14 - transcriptIn * 14}px) scale(${0.98 + transcriptIn * 0.02})`
                      }}
                    >
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        <MetaBadge label="14 words" tone="success" />
                        <MetaBadge label="4.2s" tone="neutral" />
                        <MetaBadge label="Model: base.en" tone="neutral" />
                      </div>
                      <div style={{ marginTop: 18, fontSize: 24, lineHeight: 1.5, color: "#ecfdf5", letterSpacing: "-0.02em" }}>
                        {transcriptText}
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        marginTop: 20,
                        minHeight: 182,
                        padding: 22,
                        borderRadius: 24,
                        border: mode === "transcribing"
                          ? "1px solid rgba(115,163,255,0.18)"
                          : mode === "listening"
                            ? "1px solid rgba(249,115,22,0.16)"
                            : "1px solid rgba(255,255,255,0.07)",
                        background: "linear-gradient(180deg, rgba(13,13,13,0.96), rgba(8,8,8,0.98))",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: "#f5f5f5" }}>{verificationStatusLabel(mode)}</div>
                          <div style={{ marginTop: 10, fontSize: 17, color: "#71717a", lineHeight: 1.45, maxWidth: 560 }}>
                            A successful shortcut-triggered dictation unlocks the Finish setup button.
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 42 }}>
                          {waveformBars.map((bar, index) => {
                            const animatedHeight = 12 + bar * 26 * pulse + (index % 3) * 2;
                            const color = mode === "transcribing" ? "#73a3ff" : "#f97316";

                            return (
                              <div
                                key={`wave-${index}`}
                                style={{
                                  width: 8,
                                  height: mode === "armed" ? 12 : animatedHeight,
                                  borderRadius: 999,
                                  background: color,
                                  opacity: mode === "armed" ? 0.3 : 0.95
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 17, color: "#71717a" }}>
                  {mode === "passed"
                    ? "That shortcut run worked. Review the transcript below, then finish setup."
                    : "One successful test dictation is still required before setup can finish."}
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                  <div
                    style={{
                      padding: "12px 18px",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.03)",
                      color: "#a1a1aa",
                      fontSize: 17,
                      fontWeight: 600
                    }}
                  >
                    Back
                  </div>
                  <div
                    style={{
                      padding: "12px 20px",
                      borderRadius: 14,
                      border: mode === "passed" ? "1px solid rgba(249,115,22,0.24)" : "1px solid rgba(255,255,255,0.08)",
                      background: mode === "passed" ? "#f97316" : "rgba(255,255,255,0.06)",
                      color: mode === "passed" ? "#190d03" : "#71717a",
                      fontSize: 17,
                      fontWeight: 800,
                      boxShadow: mode === "passed" ? `0 18px 34px rgba(249,115,22,${0.18 * finishGlow})` : "none"
                    }}
                  >
                    Finish setup
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {overlayVisible ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 42,
            width: 308,
            padding: "14px 16px",
            borderRadius: 18,
            background:
              "linear-gradient(180deg, rgba(18, 24, 32, 0.92), rgba(12, 18, 25, 0.9)), rgba(16, 22, 29, 0.9)",
            border: `1px solid ${overlayStyle.border}`,
            boxShadow: "0 18px 32px rgba(0, 0, 0, 0.28)",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            opacity: overlayOpacity,
            transform: `translateX(-50%) translateY(${overlayLift}px)`
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              marginTop: 3,
              borderRadius: 999,
              background: overlayStyle.dot,
              transform: overlayMode === "message" ? "scale(1)" : `scale(${0.9 + 0.1 * pulse})`,
              boxShadow: overlayMode === "message"
                ? "0 0 0 rgba(0,0,0,0)"
                : `0 0 0 ${9 * (1 - pulse)}px ${overlayStyle.ring}`
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                margin: "0 0 4px",
                color: "rgba(238, 247, 255, 0.7)",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.14em"
              }}
            >
              {overlayLabels.kicker}
            </div>
            <div style={{ color: "#f9fdff", fontSize: 14, lineHeight: 1.35 }}>{overlayLabels.text}</div>
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
