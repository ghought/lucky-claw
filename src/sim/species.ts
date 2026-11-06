export type Vec3 = readonly [number, number, number];

export interface Ball {
  p: Vec3;
  r: number;
}

export type SpeciesId =
  | 'bear'
  | 'bunny'
  | 'cat'
  | 'penguin'
  | 'frog'
  | 'pig'
  | 'chick'
  | 'monster';

export interface Species {
  id: SpeciesId;
  label: string;
  names: string[];
  mass: number;
  balls: Ball[];
}

const limbs = (s: number): Ball[] => [
  { p: [0.07 * s, 0.012 * s, 0.012 * s], r: 0.021 * s },
  { p: [-0.07 * s, 0.012 * s, 0.012 * s], r: 0.021 * s },
  { p: [0.036 * s, -0.066 * s, 0.03 * s], r: 0.024 * s },
  { p: [-0.036 * s, -0.066 * s, 0.03 * s], r: 0.024 * s },
];

const biped = (s: number, headR = 0.056): Ball[] => [
  { p: [0, -0.008 * s, 0], r: 0.056 * s },
  { p: [0, 0.082 * s, 0.006 * s], r: headR * s },
  ...limbs(s),
];

export const SPECIES: Record<SpeciesId, Species> = {
  bear: {
    id: 'bear',
    label: 'Bear',
    names: ['Bramble', 'Biscuit', 'Maple', 'Waffles'],
    mass: 0.13,
    balls: [
      ...biped(1),
      { p: [0.044, 0.128, 0], r: 0.019 },
      { p: [-0.044, 0.128, 0], r: 0.019 },
    ],
  },
  bunny: {
    id: 'bunny',
    label: 'Bunny',
    names: ['Clover', 'Thimble', 'Juniper', 'Pip'],
    mass: 0.12,
    balls: [
      ...biped(0.96),
      { p: [0.024, 0.165, -0.004], r: 0.018 },
      { p: [-0.024, 0.165, -0.004], r: 0.018 },
    ],
  },
  cat: {
    id: 'cat',
    label: 'Cat',
    names: ['Miso', 'Pepper', 'Noodle', 'Sprout'],
    mass: 0.12,
    balls: [...biped(0.97, 0.058)],
  },
  penguin: {
    id: 'penguin',
    label: 'Penguin',
    names: ['Pebble', 'Tux', 'Fjord', 'Sleet'],
    mass: 0.12,
    balls: [
      { p: [0, -0.02, 0], r: 0.066 },
      { p: [0, 0.062, 0.002], r: 0.054 },
      { p: [0.066, 0.0, 0.0], r: 0.018 },
      { p: [-0.066, 0.0, 0.0], r: 0.018 },
      { p: [0.03, -0.078, 0.04], r: 0.02 },
      { p: [-0.03, -0.078, 0.04], r: 0.02 },
    ],
  },
  frog: {
    id: 'frog',
    label: 'Frog',
    names: ['Lily', 'Fennel', 'Bog', 'Hopkins'],
    mass: 0.12,
    balls: [
      { p: [0, -0.012, 0], r: 0.06 },
      { p: [0, 0.068, 0.012], r: 0.056 },
      { p: [0.03, 0.112, 0.022], r: 0.024 },
      { p: [-0.03, 0.112, 0.022], r: 0.024 },
      ...limbs(1),
    ],
  },
  pig: {
    id: 'pig',
    label: 'Pig',
    names: ['Truffle', 'Dumpling', 'Rosie', 'Hamlet'],
    mass: 0.13,
    balls: [
      { p: [0, -0.012, 0], r: 0.064 },
      { p: [0, 0.074, 0.01], r: 0.058 },
      { p: [0, 0.066, 0.062], r: 0.022 },
      ...limbs(1),
    ],
  },
  chick: {
    id: 'chick',
    label: 'Chick',
    names: ['Sunny', 'Nugget', 'Butter', 'Peep'],
    mass: 0.1,
    balls: [
      { p: [0, -0.015, 0], r: 0.07 },
      { p: [0, 0.058, 0.004], r: 0.056 },
      { p: [0.066, 0.0, 0], r: 0.016 },
      { p: [-0.066, 0.0, 0], r: 0.016 },
    ],
  },
  monster: {
    id: 'monster',
    label: 'Monster',
    names: ['Gloop', 'Zib', 'Mumble', 'Oog'],
    mass: 0.13,
    balls: [
      { p: [0, 0.012, 0], r: 0.078 },
      { p: [0.05, 0.095, 0], r: 0.016 },
      { p: [-0.05, 0.095, 0], r: 0.016 },
      ...limbs(1.02),
    ],
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];
