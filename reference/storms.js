// The photograph and the storms in it.
// Positions and radii are in pixels of the full-size image (1920 x 1630).
// Circling one of these with the pointer spins it up.

export const IMAGE = {
  width: 1920,
  height: 1630,
  // CSS object-position of the photo when the viewport crops it.
  // On wide screens only a horizontal band of the photo fits; y = 0.45 keeps
  // the white cloud mass and the large dark storms in it. On phones,
  // x = 0.45 keeps the white clouds on the left partly in frame.
  focus: [0.45, 0.45],
  sources: [
    { src: '/jupiter/jupiter-1280.webp', width: 1280 },
    { src: '/jupiter/jupiter-1920.webp', width: 1920 },
  ],
};

export const STORMS = [
  { x: 935, y: 1040, r: 150 },  // large dark storm, centre
  { x: 1145, y: 845, r: 95 },   // dark round storm with rings, right of centre
  { x: 1000, y: 690, r: 70 },   // dark eye under the white tendrils
  { x: 590, y: 215, r: 80 },    // bright oval, top
  { x: 1290, y: 355, r: 75 },   // faint oval, top right
  { x: 1680, y: 545, r: 85 },   // white spiral, right
  { x: 1450, y: 690, r: 35 },   // small spiral, right
  { x: 345, y: 775, r: 55 },    // curl under the white cloud mass, left
  { x: 150, y: 905, r: 75 },    // pale oval, left edge
  { x: 570, y: 1180, r: 75 },   // dark oval, lower left
  { x: 1265, y: 1145, r: 65 },  // ringed oval, lower right of centre
  { x: 1185, y: 1305, r: 70 },  // dark oval, bottom
  { x: 1640, y: 1460, r: 90 },  // concentric rings, bottom right
];
