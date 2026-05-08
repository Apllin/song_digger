"use client";

import { Warp } from "@paper-design/shaders-react";

export function HomeBackground() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      <Warp
        width="100%"
        height="100%"
        colors={["#b7bff0", "#2b427d", "#0c1027"]}
        proportion={0.64}
        softness={1}
        distortion={0.2}
        swirl={0}
        swirlIterations={7}
        shape="edge"
        shapeScale={0.6}
        speed={3.4}
        rotation={148}
      />
    </div>
  );
}
