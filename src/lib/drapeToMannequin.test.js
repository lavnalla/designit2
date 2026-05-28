// drapeToMannequin.test.js
// Simple test for drapeToMannequin
const { drapeToMannequin } = require('./drapeToMannequin');

function printMask(mask) {
  return mask.map(row => row.map(v => (v ? '#' : '.')).join('')).join('\n');
}

// Example: 5x5 garment and mannequin
const garment = [
  [0,0,1,0,0],
  [0,1,1,1,0],
  [1,1,1,1,1],
  [0,0,0,0,0],
  [0,0,0,0,0],
];
const mannequin = [
  [0,0,0,0,0],
  [0,0,0,0,0],
  [0,0,0,0,0],
  [0,1,1,1,0],
  [1,1,1,1,1],
];

console.log('Before:');
console.log('Garment:\n' + printMask(garment));
console.log('Mannequin:\n' + printMask(mannequin));

const draped = drapeToMannequin(garment, mannequin);
console.log('After Draping:');
console.log(printMask(draped));
