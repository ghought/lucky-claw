// All dimensions are metres and match a real ~1.9 m crane cabinet.

export const BOX = {
  halfW: 0.35,
  halfD: 0.35,
  floorY: 0.8,
  ceilY: 1.72,
};

/** Prize chute: a hole in the bed at the front-left, fenced by a clear lip. */
export const CHUTE = {
  x0: -0.35,
  x1: -0.09,
  z0: 0.09,
  z1: 0.35,
  lip: 0.13,
  binY: 0.34,
};

export const HOME = { x: -0.215, z: 0.215 };

export const CLAW = {
  trolleyY: 1.66,
  ropeHome: 0.1,
  ropeMax: 0.66,
  limit: 0.22, // trolley travel from centre; keeps the closed claw off the glass
  maxSpeed: 0.27,
  accel: 1.5,
  dropSpeed: 0.3,
  liftSpeed: 0.2,
  returnSpeed: 0.22,
  returnAccel: 1.0,
  swingDamping: 1.9,

  hingeRadius: 0.032,
  hingeDrop: 0.05,
  openAngle: 0.68, // radians about the hinge
  restAngle: 0.14, // relaxed, slightly open while travelling
  fingerMass: 0.05,
  closeTime: 0.85,
  releaseTime: 0.7,
  slackForce: 30, // N of vertical load before the cable goes slack; plush gives way until then
  releaseAngle: 0.6, // over the chute: wide enough for the fattest prize, clear of the glass
  /** Finger centreline in (radial, y) relative to the hinge, fully closed. */
  fingerPath: [
    [0.0, 0.0],
    [0.04, -0.034],
    [0.056, -0.09],
    [0.044, -0.148],
    [0.012, -0.186],
    [-0.016, -0.192],
  ] as ReadonlyArray<readonly [number, number]>,
  fingerRadius: 0.0075,
  tipRadius: 0.0105,
};

export const GRIP = {
  /** Solenoid torque (N·m) per finger. */
  close: 0.34,
  carryMin: 0.06,
  carryMax: 0.19,
  open: 0.5,
  /** Plays without a win before the machine pays out at full strength. */
  pityAfter: 6,
};

export const PLAY_SECONDS = 25;
export const PHYSICS_HZ = 120;
