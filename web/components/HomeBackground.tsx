"use client";

import { ShaderGradientCanvas, ShaderGradient } from "@shadergradient/react";

export function HomeBackground() {
  return (
    <ShaderGradientCanvas
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
      pixelDensity={2.8}
      fov={40}
    >
      <ShaderGradient
        control="props"
        animate="on"
        brightness={0.9}
        cAzimuthAngle={180}
        cDistance={5.01}
        cPolarAngle={90}
        cameraZoom={1}
        color1="#090e66"
        color2="#1d83c2"
        color3="#00003e"
        envPreset="city"
        grain="on"
        lightType="3d"
        positionX={-1.4}
        positionY={0}
        positionZ={0}
        range="disabled"
        rangeEnd={40}
        rangeStart={0}
        reflection={0.1}
        rotationX={0}
        rotationY={10}
        rotationZ={50}
        shader="defaults"
        type="plane"
        uAmplitude={1}
        uDensity={3.5}
        uFrequency={5.5}
        uSpeed={0.2}
        uStrength={0.4}
        uTime={0}
        wireframe={false}
      />
    </ShaderGradientCanvas>
  );
}
