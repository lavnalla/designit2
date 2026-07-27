'use client';

import { useEffect, useRef } from 'react';
import BodySilhouetteComponent from './BodySilhouette';

export default function BodySilhouetteView() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const trackerRef = useRef(null);

  useEffect(() => {
    let stream = null;

    async function initCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Wait until window.bodyPix is loaded from the script tag
        const checkBodyPix = setInterval(async () => {
          if (window.bodyPix && videoRef.current && canvasRef.current) {
            clearInterval(checkBodyPix);
            trackerRef.current = new BodySilhouetteComponent(
              videoRef.current,
              canvasRef.current
            );
            await trackerRef.current.start();
          }
        }, 100);

      } catch (err) {
        console.error('Webcam access error:', err);
      }
    }

    initCamera();

    return () => {
      if (trackerRef.current) {
        trackerRef.current.stop();
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '640px', height: '480px' }}>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
        }}
      />
      <canvas
        ref={canvasRef}
        width={640}
        height={480}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          transform: 'scaleX(-1)',
        }}
      />
    </div>
  );
}