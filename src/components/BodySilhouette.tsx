// components/BodySilhouette.jsx

class BodySilhouetteComponent {
  constructor(videoElement, canvasElement) {
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.net = null;
    this.isRunning = false;
    this.animationFrameId = null;
  }

  async initialize() {
    try {
      this.net = await window.bodyPix.load({
        architecture: 'MobileNetV1',
        outputStride: 16,
        multiplier: 0.75,
        quantBytes: 2
      });
    } catch (error) {
      console.error('Failed to load BodyPix model:', error);
    }
  }

  async start() {
    if (!this.net) {
      await this.initialize();
    }
    if (this.isRunning) return;
    this.isRunning = true;
    this.renderFrame();
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  async renderFrame() {
    if (!this.isRunning) return;

    if (this.videoElement.readyState >= 2) {
      const segmentation = await this.net.segmentPerson(this.videoElement, {
        internalResolution: 'medium',
        segmentationThreshold: 0.7
      });

      this.ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
      this.ctx.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height);

      this.ctx.strokeStyle = '#00FF00';
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();

      const data = segmentation.data;
      const width = segmentation.width;
      const height = segmentation.height;

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          if (data[idx] === 1) {
            if (
              data[idx - 1] === 0 || 
              data[idx + 1] === 0 || 
              data[idx - width] === 0 || 
              data[idx + width] === 0
            ) {
              const drawX = (x / width) * this.canvasElement.width;
              const drawY = (y / height) * this.canvasElement.height;
              this.ctx.rect(drawX, drawY, 2, 2);
            }
          }
        }
      }
      this.ctx.stroke();
    }

    if (this.isRunning) {
      this.animationFrameId = requestAnimationFrame(() => this.renderFrame());
    }
  }
}

export default BodySilhouetteComponent;