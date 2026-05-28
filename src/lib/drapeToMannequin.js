// drapeToMannequin.js
// Generic implementation for draping a garment image onto a mannequin image with gravity effect
// Assumes both images are 2D arrays of pixels (RGBA or binary mask)

/**
 * Simulates draping a garment over a mannequin, letting overflow pixels fall down.
 * @param {Array<Array<number>>} garment - 2D array (rows x cols) representing the garment mask (1=garment, 0=empty)
 * @param {Array<Array<number>>} mannequin - 2D array (rows x cols) representing the mannequin mask (1=mannequin, 0=empty)
 * @returns {Array<Array<number>>} - New garment mask after draping
 */
function drapeToMannequin(garment, mannequin) {
  const rows = garment.length;
  const cols = garment[0].length;
  // Deep copy garment to avoid mutating input
  const draped = garment.map(row => row.slice());

  for (let col = 0; col < cols; col++) {
    // Find the lowest mannequin pixel in this column
    let mannequinBottom = -1;
    for (let row = rows - 1; row >= 0; row--) {
      if (mannequin[row][col]) {
        mannequinBottom = row;
        break;
      }
    }
    // For each row above mannequinBottom, if garment pixel is below mannequin, let it fall
    for (let row = rows - 1; row > mannequinBottom; row--) {
      if (draped[row][col] && !mannequin[row][col]) {
        // Let this pixel fall until it hits mannequin or bottom
        let fallTo = row;
        while (fallTo + 1 < rows && !mannequin[fallTo + 1][col] && !draped[fallTo + 1][col]) {
          fallTo++;
        }
        if (fallTo !== row) {
          draped[fallTo][col] = 1;
          draped[row][col] = 0;
        }
      }
    }
  }
  return draped;
}

export { drapeToMannequin };