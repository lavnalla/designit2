// Trigger build: 2026-02-24

"use client";


import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import NecklaceTryOn from "./NecklaceTryOn";
import { 
  ChevronDown, Eraser, Trash, Plus, Image as ImageIcon, Ruler, Ghost, Video, Upload, ArrowLeft, 
  Shirt, Grid, MousePointer, PaintBucket, PenTool, Edit3, Type, Shapes, Palette, Layers, Undo2, 
  Redo2, Save, Download, Play, Users 
} from "lucide-react";
import ImageTracer from "imagetracerjs";
import { removeBackground, preload } from '@imgly/background-removal';
import { SubmissionModal } from './SubmissionModal';

const AdBanner = () => {
  useEffect(() => {
    try {
      // @ts-ignore
      const adsbygoogle = window.adsbygoogle || [];
      // Only push if the ad hasn't been initialized yet
      if (adsbygoogle.length === 0) {
        adsbygoogle.push({});
      }
    } catch (err) {
      console.error('AdSense error:', err);
    }
  }, []);

  return (
    <div className="w-full bg-slate-100 border-t border-slate-200 flex justify-center items-center py-2 shrink-0 min-h-[60px] md:min-h-[100px] overflow-hidden z-50 relative">
      <ins className="adsbygoogle"
           style={{ display: 'block', width: '100%', maxWidth: '728px', height: '90px' }}
           data-ad-client="ca-pub-7392693183875834"
           data-ad-slot="auto"
           data-ad-format="auto"
           data-full-width-responsive="true"></ins>
    </div>
  );
};

interface Dot { id: string; x: number; y: number; }
interface DistortableShape {
  id: string;
  img: string;
  dots: Dot[];
  dims: { width: number; height: number };
  position: { x: number; y: number };
  scale: number;
  rotation?: number;
  showDots: boolean;
  fillColor?: string;
  clothType?: string;
  baseFill?: string;
  fillOpacity?: number;
  erasedPaths: string[];
  isMannequin?: boolean;
  isGarment?: boolean;
  groupId?: string;
  zIndex?: number;
  stretchFactor?: number;
  isDrapingAnimated?: boolean;
}
interface Stroke { 
  id: string; 
  points: { id: string; x: number; y: number }[]; 
  color: string; 
  width: number; 
  rotation?: number;
  fillColor?: string;
  clothType?: string;
  baseFill?: string;
  fillOpacity?: number;
  groupId?: string;
  closed?: boolean;
  zIndex?: number;
  visible?: boolean;
}
type HistoryItem = { shapes: DistortableShape[]; strokes: Stroke[] };
type Candidate = { id: string; d: string; area: number; selected: boolean; };

interface MannequinMeasurements {
  bust: number;
  underBust: number;
  waist: number;
  hips: number;
  torsoLength: number;
  shoulderWidth: number;
  neckCircumference: number;
}

export function Studio({ onBack }: { onBack: () => void }) {
      const [refineError, setRefineError] = useState<string | null>(null);
    // Refine image state
    const [refinePrompt, setRefinePrompt] = useState("");
    const [isRefiningImage, setIsRefiningImage] = useState(false);
    // ...existing state hooks...
    // All shape state hooks...
    const [workspaceShapes, setWorkspaceShapes] = useState<DistortableShape[]>([]);
    // ...other state hooks...
    // Place after workspaceShapes is defined:
    const [selectedShapeId, setSelectedShapeId] = useState<string|null>(null);
    const selectedShape = selectedShapeId ? workspaceShapes?.find(s => s.id === selectedShapeId) : null;

    // Helper: convert dataURL to File
    function dataURLtoFile(dataurl: string, filename: string) {
      const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
      for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
      return new File([u8arr], filename, { type: mime });
    }

    // Refine handler
    const handleRefineImage = async () => {
      setRefineError(null);
      if (!selectedShape || !selectedShape.img) {
        setRefineError('No shape or image selected.');
        console.warn('Refine: No selected shape or image.', { selectedShape });
        return;
      }
      setIsRefiningImage(true);
      try {
        // Convert base64 or dataURL to File
        let file: File;
        if (selectedShape.img.startsWith('data:')) {
          file = dataURLtoFile(selectedShape.img, 'selected.png');
        } else {
          // fallback: fetch as blob
          const res = await fetch(selectedShape.img);
          const blob = await res.blob();
          file = new File([blob], 'selected.png', { type: blob.type });
        }
        const formData = new FormData();
        formData.append('image', file);
        formData.append('prompt', refinePrompt);
        formData.append('image_strength', '0.7');
        formData.append('cfg_scale', '7');
        formData.append('steps', '30');
        const response = await fetch('/api/refine-image', { method: 'POST', body: formData });
        let data;
        try {
          data = await response.json();
        } catch (err) {
          setRefineError('Failed to parse response from server.');
          console.error('Refine: Failed to parse response', err);
          return;
        }
        console.log('Refine: API response', data);
        if (data.resultImage) {
          setWorkspaceShapes(prev => prev.map(s => s.id === selectedShapeId ? { ...s, img: data.resultImage } : s));
        } else if (data.error) {
          setRefineError('API error: ' + data.error);
        } else {
          setRefineError('No image returned from API.');
        }
      } catch (err: any) {
        setRefineError('Network or server error: ' + (err?.message || err));
        console.error('Refine: Network/server error', err);
      } finally {
        setIsRefiningImage(false);
      }
    };
  // helper: convert hex color + alpha (0..1) to rgba() string
  const hexToRgba = (hex: string, alpha = 1) => {
    if (!hex) return `rgba(0,0,0,${alpha})`;
    const h = hex.replace('#','');
    const normalized = h.length === 3 ? h.split('').map(c=>c+c).join('') : h;
    const bigint = parseInt(normalized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  };
  // Generate a texture data URL for cloth types (higher variety + distinct styles)
  const generateTextureDataUrl = (color: string, type: string, size = 128) => {
    try {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      if (!ctx) return '';
      // base
      ctx.fillStyle = color;
      ctx.fillRect(0,0,size,size);

      // helper: apply subtle noise
      const applyNoise = (amount = 0.03, dots = 1000) => {
        for (let i=0;i<dots;i++) { ctx.fillStyle = `rgba(255,255,255,${Math.random()*amount})`; ctx.fillRect(Math.random()*size, Math.random()*size, 1, 1); }
      };

      if (type === 'cotton') {
        // fine matte grain
        applyNoise(0.035, 1200);
      } else if (type === 'linen') {
        // visible cross-thread weave with slight irregularity
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = Math.max(1, size/64);
        for (let i = 0; i < size; i += Math.max(8, Math.round(size/12))) { ctx.beginPath(); const xJitter = (Math.random()-0.5)*2; ctx.moveTo(i + xJitter,0); ctx.lineTo(i + xJitter,size); ctx.stroke(); }
        for (let j = 0; j < size; j += Math.max(8, Math.round(size/12))) { ctx.beginPath(); const yJitter = (Math.random()-0.5)*2; ctx.moveTo(0,j + yJitter); ctx.lineTo(size,j + yJitter); ctx.stroke(); }
        applyNoise(0.02, 500);
      } else if (type === 'denim') {
        // diagonal twill with brighter weft lines
        const twill = Math.max(6, Math.round(size/20)); ctx.lineWidth = Math.max(1, size/96);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        for (let i = -size; i < size*2; i += twill) { ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i + size, size); ctx.stroke(); }
        // subtle shadow overlay for depth
        ctx.globalAlpha = 0.06; ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0,0,size,size); ctx.globalAlpha = 1;
        applyNoise(0.02, 500);
      } else if (type === 'silk') {
        // smooth directional sheen
        const g = ctx.createLinearGradient(-size*0.2,0,size*0.8,0); g.addColorStop(0,'rgba(255,255,255,0.24)'); g.addColorStop(0.5,'rgba(255,255,255,0.02)'); g.addColorStop(1,'rgba(255,255,255,0.18)');
        ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = g; ctx.fillRect(0,0,size,size); ctx.globalCompositeOperation = 'source-over';
        // soft curved highlight
        ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.ellipse(size*0.5, size*0.35, size*0.7, size*0.2, -0.25, 0, Math.PI*2); ctx.fillStyle = 'white'; ctx.fill(); ctx.globalAlpha = 1;
      } else if (type === 'velvet') {
        // dense pile with vertical sheen
        applyNoise(0.02, 500);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = Math.max(1, size/160);
        for (let x = 0; x < size; x += 2) { const h = (Math.random()*2-1)*2; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x + h, size); ctx.stroke(); }
        // vertical subtle streaks
        ctx.globalAlpha = 0.06; const gradV = ctx.createLinearGradient(0,0,0,size); gradV.addColorStop(0,'white'); gradV.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle = gradV; ctx.fillRect(0,0,size,size); ctx.globalAlpha = 1;
      } else if (type === 'spun') {
        // short directional fiber strokes
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = Math.max(1, size/160);
        for (let i=0;i<3000;i++) { const x = Math.random()*size; const y = Math.random()*size; const len = Math.random()*8 + 2; const ang = (Math.random()-0.5)*Math.PI; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x + Math.cos(ang)*len, y + Math.sin(ang)*len); ctx.stroke(); }
        applyNoise(0.01, 300);
      } else if (type === 'chiffon') {
        // chiffon: produce an inline SVG data-URL (layered translucent folds)
        try {
          const w = size, h = size;
          const base = color;
          const svg = `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>\n  <defs>\n    <linearGradient id='gSoft' x1='0' y1='0' x2='1' y2='0'>\n      <stop offset='0' stop-color='rgba(255,255,255,0.20)'/>\n      <stop offset='0.5' stop-color='rgba(255,255,255,0.03)'/>\n      <stop offset='1' stop-color='rgba(255,255,255,0.14)'/>\n    </linearGradient>\n    <filter id='blurLarge' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='8' result='b'/></filter>\n    <filter id='blurSmall' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='3' result='s'/></filter>\n    <radialGradient id='grain' cx='50%' cy='50%' r='50%'><stop offset='0' stop-color='rgba(255,255,255,0.02)'/><stop offset='1' stop-color='rgba(255,255,255,0)'/></radialGradient>\n  </defs>\n  <rect width='100%' height='100%' fill='${base}'/>\n  <!-- layered translucent folds -->\n  <g opacity='0.9' filter='url(#blurLarge)'>\n    <path d='M0 ${Math.round(h*0.08)} C ${Math.round(w*0.18)} ${Math.round(h*0.02)} ${Math.round(w*0.42)} ${Math.round(h*0.22)} ${Math.round(w*0.6)} ${Math.round(h*0.08)} C ${Math.round(w*0.76)} ${Math.round(h*0.0)} ${Math.round(w*0.9)} ${Math.round(h*0.14)} ${w} ${Math.round(h*0.08)} L ${w} ${h} L 0 ${h} Z' fill='white' opacity='0.07'/>\n    <path d='M0 ${Math.round(h*0.38)} C ${Math.round(w*0.14)} ${Math.round(h*0.26)} ${Math.round(w*0.36)} ${Math.round(h*0.6)} ${Math.round(w*0.62)} ${Math.round(h*0.36)} C ${Math.round(w*0.78)} ${Math.round(h*0.24)} ${Math.round(w*0.9)} ${Math.round(h*0.46)} ${w} ${Math.round(h*0.38)} L ${w} ${h} L 0 ${h} Z' fill='white' opacity='0.06'/>\n    <path d='M0 ${Math.round(h*0.68)} C ${Math.round(w*0.12)} ${Math.round(h*0.54)} ${Math.round(w*0.34)} ${Math.round(h*0.9)} ${Math.round(w*0.58)} ${Math.round(h*0.66)} C ${Math.round(w*0.76)} ${Math.round(h*0.5)} ${Math.round(w*0.9)} ${Math.round(h*0.76)} ${w} ${Math.round(h*0.68)} L ${w} ${h} L 0 ${h} Z' fill='white' opacity='0.05'/>\n  </g>\n  <!-- finer folds and highlights -->\n  <g opacity='0.8' filter='url(#blurSmall)'>\n    <path d='M0 ${Math.round(h*0.18)} C ${Math.round(w*0.22)} ${Math.round(h*0.08)} ${Math.round(w*0.44)} ${Math.round(h*0.28)} ${Math.round(w*0.64)} ${Math.round(h*0.14)} C ${Math.round(w*0.8)} ${Math.round(h*0.06)} ${Math.round(w*0.92)} ${Math.round(h*0.2)} ${w} ${Math.round(h*0.18)} L ${w} ${h} L 0 ${h} Z' fill='white' opacity='0.04'/>\n    <path d='M0 ${Math.round(h*0.5)} C ${Math.round(w*0.16)} ${Math.round(h*0.36)} ${Math.round(w*0.38)} ${Math.round(h*0.66)} ${Math.round(w*0.62)} ${Math.round(h*0.44)} C ${Math.round(w*0.78)} ${Math.round(h*0.32)} ${Math.round(w*0.9)} ${Math.round(h*0.52)} ${w} ${Math.round(h*0.5)} L ${w} ${h} L 0 ${h} Z' fill='white' opacity='0.035'/>\n  </g>\n  <!-- soft sheen overlay -->\n  <rect width='100%' height='100%' fill='url(#gSoft)' opacity='0.06'/>\n  <!-- subtle grain to simulate fibres -->\n  <rect width='100%' height='100%' fill='url(#grain)' opacity='0.02'/>\n</svg>`;
          return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        } catch (err) {
          // fallback to canvas-based subtle noise
          ctx.globalAlpha = 0.55; ctx.fillStyle = color; ctx.fillRect(0,0,size,size); ctx.globalAlpha = 1;
          const g2 = ctx.createLinearGradient(0,0,0,size); g2.addColorStop(0, 'rgba(255,255,255,0.16)'); g2.addColorStop(0.5, 'rgba(255,255,255,0.02)'); g2.addColorStop(1, 'rgba(255,255,255,0.08)'); ctx.fillStyle = g2; ctx.fillRect(0,0,size,size);
          applyNoise(0.008, 250);
        }
      } else if (type === 'polyester') {
        // micro-grid with subtle sheen
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = Math.max(0.6, size/256);
        const step = Math.max(3, Math.round(size/20));
        for (let i=0;i<size;i += step) { ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,size); ctx.stroke(); }
        for (let j=0;j<size;j += step) { ctx.beginPath(); ctx.moveTo(0,j); ctx.lineTo(size,j); ctx.stroke(); }
        applyNoise(0.01, 350);
      }

      return c.toDataURL('image/png');
    } catch (e) { return ''; }
  };

  // Map specific fabric names to the texture generator types used above.
  // This allows selecting a human-friendly fabric name (e.g. "satin") and
  // reusing an appropriate generator (e.g. `silk`) without duplicating code.
  const FABRIC_NAME_MAP: Record<string, string> = {
    // Base types
    gem: 'gem',
    solid: 'solid',
    cotton: 'cotton',
    linen: 'linen',
    denim: 'denim',
    silk: 'silk',
    velvet: 'velvet',
    spun: 'spun',
    chiffon: 'chiffon',
    polyester: 'polyester',
    jersey: 'jersey',
    'double jersey': 'double_jersey',
    interlock: 'interlock',
    'french terry': 'french_terry',
    'sweater knit': 'sweater',
    ponte: 'ponte',
    scuba: 'scuba',
    'rib knit': 'rib',
    rib: 'rib',
    mesh: 'mesh',
    ity: 'ity',
    
    // Mapped from glossary
    acetate: 'acetate',
    bamboo: 'bamboo',
    batik: 'batik',
    boucle: 'boucle',
    broadcloth: 'broadcloth',
    brocade: 'brocade',
    buckram: 'buckram',
    calico: 'calico',
    cambric: 'cambric',
    canvas: 'canvas',
    cashmere: 'cashmere',
    challis: 'challis',
    cheesecloth: 'cheesecloth',
    chenille: 'chenille',
    chintz: 'chintz',
    coir: 'coir',
    corduroy: 'corduroy',
    crepe: 'crepe',
    'crepe de chine': 'crepe_de_chine',
    damask: 'damask',
    dobby: 'dobby',
    duck: 'duck',
    elastane: 'elastane',
    'faux fur': 'faux_fur',
    felt: 'felt',
    flannel: 'flannel',
    flannelette: 'flannelette',
    fleece: 'fleece',
    gabardine: 'gabardine',
    georgette: 'georgette',
    gingham: 'gingham',
    goretex: 'goretex',
    grosgrain: 'grosgrain',
    hemp: 'hemp',
    hessian: 'hessian',
    jacquard: 'jacquard',
    'jersey knit': 'jersey_knit',
    jute: 'jute',
    lace: 'lace',
    lame: 'lame',
    leather: 'leather',
    lyocell: 'lyocell',
    lycra: 'lycra',
    microfiber: 'microfiber',
    modal: 'modal',
    moleskin: 'moleskin',
    muslin: 'muslin',
    neoprene: 'neoprene',
    nylon: 'nylon',
    oilcloth: 'oilcloth',
    organdy: 'organdy',
    organza: 'organza',
    poplin: 'poplin',
    rayon: 'rayon',
    sateen: 'sateen',
    satin: 'satin',
    scrim: 'scrim',
    seersucker: 'seersucker',
    sheer: 'sheer',
    slub: 'slub',
    spandex: 'spandex',
    stretch: 'stretch',
    suede: 'suede',
    taffeta: 'taffeta',
    tencel: 'tencel',
    terrycloth: 'terrycloth',
    thick: 'thick',
    ticking: 'ticking',
    toile: 'toile',
    tulle: 'tulle',
    tweed: 'tweed',
    twill: 'twill',
    velveteen: 'velveteen',
    velour: 'velour',
    viscose: 'viscose',
    voile: 'voile',
    wool: 'wool',

    'default': 'solid'
  };

  const normalizeFabric = (name?: string) => {
    if (!name) return 'solid';
    const key = name.trim().toLowerCase();
    return FABRIC_NAME_MAP[key] || FABRIC_NAME_MAP[key.replace(/s$/,'')] || FABRIC_NAME_MAP['default'];
  };

  // Helper to get the correct image path for a fabric
  const getFabricImagePath = (fabricName: string) => {
    const normalized = normalizeFabric(fabricName);
    
    if (normalized === 'voile') return '/swatches/voile.avif';

    // Check if we have a specific JPG for this fabric
    const jpgFabrics = [
      'acetate', 'batik', 'boucle', 'brocade', 'buckram', 'calico', 'cambric', 'canvas', 'cashmere',
      'cheesecloth', 'chenille', 'chiffon', 'chintz', 'coir', 'corduroy', 'cotton', 'crepe', 'crepe_de_chine',
      'denim', 'dobby', 'elastane', 'faux_fur', 'felt', 'flannel', 'flannelette', 'fleece', 'french_terry',
      'gabardine', 'georgette', 'gingham', 'goretex', 'grosgrain', 'hemp', 'hessian', 'jacquard',
      'jersey_knit', 'jute', 'lace', 'lame', 'leather', 'linen', 'lycra', 'lyocell', 'microfiber',
      'moleskin', 'muslin', 'neoprene', 'organza', 'rib_knit', 'satin', 'spandex', 'suede', 'taffeta',
      'terrycloth', 'ticking', 'toile', 'tulle', 'velvet', 'wool'
    ];
    
    if (jpgFabrics.includes(normalized)) {
      return `/swatches/${normalized}.jpg`;
    }
    
    // Fallback to generated texture
    return null;
  };

  const fabricOptions = [
    { value: "solid", label: "Solid" },
    { value: "gem", label: "Gem/Crystal" },
    { value: "metallic", label: "Metallic" },
    { value: "acetate", label: "Acetate" },
    { value: "bamboo", label: "Bamboo Fabric" },
    { value: "batik", label: "Batik" },
    { value: "boucle", label: "Boucle" },
    { value: "broadcloth", label: "Broadcloth" },
    { value: "brocade", label: "Brocade" },
    { value: "buckram", label: "Buckram" },
    { value: "calico", label: "Calico" },
    { value: "cambric", label: "Cambric" },
    { value: "canvas", label: "Canvas" },
    { value: "cashmere", label: "Cashmere" },
    { value: "challis", label: "Challis" },
    { value: "cheesecloth", label: "Cheesecloth" },
    { value: "chenille", label: "Chenille" },
    { value: "chiffon", label: "Chiffon" },
    { value: "chintz", label: "Chintz" },
    { value: "coir", label: "Coir" },
    { value: "corduroy", label: "Corduroy" },
    { value: "cotton", label: "Cotton" },
    { value: "crepe", label: "Crepe" },
    { value: "crepe de chine", label: "Crepe de Chine" },
    { value: "damask", label: "Damask" },
    { value: "denim", label: "Denim" },
    { value: "dobby", label: "Dobby" },
    { value: "duck", label: "Duck" },
    { value: "elastane", label: "Elastane" },
    { value: "faux fur", label: "Faux Fur" },
    { value: "felt", label: "Felt" },
    { value: "flannel", label: "Flannel" },
    { value: "flannelette", label: "Flannelette" },
    { value: "fleece", label: "Fleece" },
    { value: "gabardine", label: "Gabardine" },
    { value: "georgette", label: "Georgette" },
    { value: "gingham", label: "Gingham" },
    { value: "goretex", label: "Goretex" },
    { value: "grosgrain", label: "Grosgrain" },
    { value: "hemp", label: "Hemp" },
    { value: "hessian", label: "Hessian" },
    { value: "jacquard", label: "Jacquard" },
    { value: "jersey knit", label: "Jersey Knit" },
    { value: "jute", label: "Jute" },
    { value: "lace", label: "Lace" },
    { value: "lame", label: "Lame" },
    { value: "leather", label: "Leather" },
    { value: "linen", label: "Linen" },
    { value: "lyocell", label: "Lyocell" },
    { value: "lycra", label: "Lycra" },
    { value: "microfiber", label: "Microfiber" },
    { value: "modal", label: "Modal" },
    { value: "moleskin", label: "Moleskin" },
    { value: "muslin", label: "Muslin" },
    { value: "neoprene", label: "Neoprene" },
    { value: "nylon", label: "Nylon" },
    { value: "oilcloth", label: "Oilcloth" },
    { value: "organdy", label: "Organdy" },
    { value: "organza", label: "Organza" },
    { value: "polyester", label: "Polyester" },
    { value: "poplin", label: "Poplin" },
    { value: "rayon", label: "Rayon" },
    { value: "sateen", label: "Sateen" },
    { value: "satin", label: "Satin" },
    { value: "scrim", label: "Scrim" },
    { value: "seersucker", label: "Seersucker" },
    { value: "sheer", label: "Sheer" },
    { value: "silk", label: "Silk" },
    { value: "slub", label: "Slub" },
    { value: "spandex", label: "Spandex" },
    { value: "stretch", label: "Stretch" },
    { value: "suede", label: "Suede" },
    { value: "taffeta", label: "Taffeta" },
    { value: "tencel", label: "Tencel" },
    { value: "terrycloth", label: "Terrycloth" },
    { value: "thick", label: "Thick" },
    { value: "ticking", label: "Ticking" },
    { value: "toile", label: "Toile" },
    { value: "tulle", label: "Tulle" },
    { value: "tweed", label: "Tweed" },
    { value: "twill", label: "Twill" },
    { value: "velvet", label: "Velvet" },
    { value: "velveteen", label: "Velveteen" },
    { value: "velour", label: "Velour" },
    { value: "viscose", label: "Viscose" },
    { value: "voile", label: "Voile" },
    { value: "wool", label: "Wool" }
  ];

  const [showTryOn, setShowTryOn] = useState(false); 
  const [renderedWorkspaceImg, setRenderedWorkspaceImg] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [tutorialDisabled, setTutorialDisabled] = useState(false);
  const [ghostCursor, setGhostCursor] = useState({ x: 0, y: 0, active: false, clicking: false });
  const [showMannequinModal, setShowMannequinModal] = useState(false);
  const [showShapesModal, setShowShapesModal] = useState(false);
  const [showDrapeModal, setShowDrapeModal] = useState(false);
  const [aiDraping, setAiDraping] = useState<{active: boolean, text: string}>({ active: false, text: "" });
  const [selectedGarmentId, setSelectedGarmentId] = useState<string | null>(null);
  const [armpitMeasurement, setArmpitMeasurement] = useState(20);
  const [garmentLength, setGarmentLength] = useState(25);
  const [measurements, setMeasurements] = useState<MannequinMeasurements>({
    bust: 111,
    underBust: 98,
    waist: 97,
    hips: 134,
    torsoLength: 51,
    shoulderWidth: 42,
    neckCircumference: 39
  });
  
  // STATE FOR 4 NECK CLICKS
  const [manualShoulderMode, setManualShoulderMode] = useState<{
    garmentId: string;
    garmentLeftShoulder?: { x: number; y: number };
    garmentRightShoulder?: { x: number; y: number };
    mannequinLeftShoulder?: { x: number; y: number };
    mannequinRightShoulder?: { x: number; y: number };
  } | null>(null);
  
  const [templates, setTemplates] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState({ width: 0, height: 0 });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [sourceDots, setSourceDots] = useState<Dot[]>([]);
  const [activeTool, setActiveTool] = useState<"cursor" | "scissor" | "pen" | "ghost" | "fill" | "erase">("cursor");
  const [workspaceBgColor, setWorkspaceBgColor] = useState<string>('amber');
  const [activeColor, setActiveColor] = useState("#27EEF5");
  const [scissorDots, setScissorDots] = useState<{x: number, y: number}[]>([]);
  const scissorTargetRef = useRef<string | null>(null);
  const [activePenSize, setActivePenSize] = useState<number>(4);
  const [activeFillOpacity, setActiveFillOpacity] = useState<number>(1);
  const [keepOriginalColor, setKeepOriginalColor] = useState<boolean>(false);
  const [selectedClothType, setSelectedClothType] = useState<string>('solid');
  const [pickColorMode, setPickColorMode] = useState<boolean>(false);
  const [pickThreshold, setPickThreshold] = useState<number>(12);
  const [showColorPanel, setShowColorPanel] = useState(false);
  const [showFabricDropdown, setShowFabricDropdown] = useState(false);
  const [isFabricLoading, setIsFabricLoading] = useState(false);
  const [globalShowDots, setGlobalShowDots] = useState(true);
  const [isLocked, setIsLocked] = useState(false); 
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; type: "shape" | "stroke" | "selection"; clickX?: number; clickY?: number } | null>(null);
  const [draggingDot, setDraggingDot] = useState<{ shapeId: string; dotId: string } | null>(null);
  const [draggingStrokeDot, setDraggingStrokeDot] = useState<{ strokeId: string; dotId: string } | null>(null);
  const [draggingShapeId, setDraggingShapeId] = useState<string | null>(null);
  const [draggingStrokeId, setDraggingStrokeId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [clipboard, setClipboard] = useState<{ shapes: DistortableShape[]; strokes: Stroke[] } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [customAssets, setCustomAssets] = useState<{name: string, path: string}[]>([]);
  const workspaceRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Place this at the top level of your Studio component (below your state declarations)
useEffect(() => {
  if (!showTryOn) return;

  const svgElement = document.getElementById("workspace-svg");
  if (!svgElement) return;

  let active = true;

  const generateFlatCanvasSnapshot = () => {
    try {
      const activeShapeObj = workspaceShapes?.find(s => s.id === selectedShapeId);
      if (!activeShapeObj) return;

      const tempCanvas = document.createElement("canvas");
      const canvasWidth = activeShapeObj.dims?.width || 512;
      const canvasHeight = activeShapeObj.dims?.height || 512;
      tempCanvas.width = canvasWidth;
      tempCanvas.height = canvasHeight;
      
      const ctx = tempCanvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      const baseImg = new Image();
      baseImg.crossOrigin = "anonymous";
      baseImg.src = activeShapeObj.img;
      
      baseImg.onload = () => {
        if (!active) return;

        // 1. Draw the raw template image layout onto the canvas context
        ctx.drawImage(baseImg, 0, 0, canvasWidth, canvasHeight);

        // 💡 NEW: If it's a blouse/mannequin template, strip out the solid background pixels instantly
        const isBlouse = activeShapeObj.id?.includes("blouse") || (activeShapeObj.img && activeShapeObj.img.includes("blouse"));
        if (isBlouse) {
          const imgData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
          const data = imgData.data;
          
          // Loop through every pixel (RGBA) to mask off the light/white backdrop space
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // Matches whites and very bright gray mannequin backgrounds
            if (r > 220 && g > 220 && b > 220) {
              data[i + 3] = 0; // Turn alpha transparent!
            }
          }
          ctx.putImageData(imgData, 0, 0);
        }

        // 2. Overlay your customized editor brush strokes on top cleanly
        if (Array.isArray(strokes)) {
          strokes.forEach((stroke) => {
            if (!stroke.points || stroke.points.length < 2) return;
            
            ctx.beginPath();
            ctx.strokeStyle = stroke.color || "#3b82f6";
            ctx.lineWidth = stroke.width || 5;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            const startPoint = stroke.points[0];
            ctx.moveTo(
              startPoint.x - activeShapeObj.position.x, 
              startPoint.y - activeShapeObj.position.y
            );

            for (let i = 1; i < stroke.points.length; i++) {
              ctx.lineTo(
                stroke.points[i].x - activeShapeObj.position.x, 
                stroke.points[i].y - activeShapeObj.position.y
              );
            }
            
            if (stroke.closed) ctx.closePath();
            ctx.stroke();
          });
        }

        // 3. Dispatch the cleanly processed composite layer to the tracker
        const flatDataUrl = tempCanvas.toDataURL("image/png");
        setRenderedWorkspaceImg(flatDataUrl);
      };

      baseImg.onerror = (err) => {
        console.error("Failed to load template layout backdrop:", err);
      };

    } catch (err) {
      console.error("Failed to generate custom composition:", err);
    }
  };

  generateFlatCanvasSnapshot();

  return () => {
    active = false;
  };
}, [showTryOn, selectedShapeId, workspaceShapes, strokes]);


  useEffect(() => {
    fetch('/api/assets')
      .then(res => res.json())
      .then(data => {
        if (data.assets) {
          setCustomAssets(data.assets);
        }
      })
      .catch(err => console.error('Failed to load assets', err));
  }, []);
  const workspaceShapesRef = useRef<DistortableShape[]>([]);
  const isPointerDownRef = useRef(false);
  const penRef = useRef<{ pointerId: number; lastX: number; lastY: number; strokeId: string } | null>(null);
  const PEN_SPACING = 30; 
  const ERASE_RADIUS = 15;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    workspaceShapesRef.current = workspaceShapes;
  }, [workspaceShapes]);

  const saveForUndo = useCallback(() => {
    setHistory(h => [...h, { shapes: JSON.parse(JSON.stringify(workspaceShapes)), strokes: JSON.parse(JSON.stringify(strokes)) }].slice(-50));
  }, [workspaceShapes, strokes]);

  // Remove sampled color from a shape's image (chroma key)
  const handlePickRemove = useCallback(async (shape: DistortableShape, clientX: number, clientY: number) => {
    try {
      saveForUndo();
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const src = shape.img;
      const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
      });

      const canvas = document.createElement('canvas');
      const w = shape.dims.width;
      const h = shape.dims.height;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(loaded, 0, 0, w, h);

      // Map client coordinates to image-local pixel coordinates
      const localX = clientX - shape.position.x;
      const localY = clientY - shape.position.y;
      const imgX = Math.round(localX / shape.scale);
      const imgY = Math.round(localY / shape.scale);
      if (imgX < 0 || imgY < 0 || imgX >= w || imgY >= h) {
        alert('Click was outside the image bounds');
        return;
      }

      const pickData = ctx.getImageData(imgX, imgY, 1, 1).data;
      const tr = pickData[0], tg = pickData[1], tb = pickData[2];

      const imageData = ctx.getImageData(0,0,w,h);
      const data = imageData.data;
      const maxDist = Math.sqrt(255*255*3);
      const thresh = (pickThreshold / 100) * maxDist;
      const threshSq = thresh * thresh;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const dr = r - tr, dg = g - tg, db = b - tb;
        const distSq = dr*dr + dg*dg + db*db;
        if (distSq <= threshSq) {
          data[i+3] = 0; // make transparent
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const newUrl = canvas.toDataURL('image/png');
      setWorkspaceShapes(prev => prev.map(s => s.id === shape.id ? { ...s, img: newUrl } : s));
      setPickColorMode(false);
    } catch (err) {
      console.error('Pick-remove failed', err);
      alert('Could not edit image. This is usually a CORS issue — try uploading the image from your computer.');
    }
  }, [pickThreshold, saveForUndo]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const next = [...history];
    const last = next.pop()!;
    setWorkspaceShapes(last.shapes);
    setStrokes(last.strokes);
    setHistory(next);
  }, [history]);

  const openDrapeModal = async (garmentId: string) => {
    const garment = workspaceShapes.find(s => s.id === garmentId);
    const mannequin = workspaceShapes.find(s => s.isMannequin);

    if (garment && mannequin && !garment.isMannequin) {
      setContextMenu(null);
      setAiDraping({ active: true, text: "Draping Fabric to Form..." });

      try {
        const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image();
          if (!src.startsWith('data:')) img.crossOrigin = "anonymous";
          img.onload = () => res(img);
          img.onerror = (e) => {
            console.error("Failed to load image", src.substring(0, 50));
            rej(e);
          };
          img.src = src;
        });

        // Custom rasterizer to ensure vectors, points, and fills map to ImageData
        const rasterizeShape = async (shape: DistortableShape) => {
          const c = document.createElement('canvas');
          c.width = shape.dims.width || 800;
          c.height = shape.dims.height || 800;
          const cx = c.getContext('2d', { willReadFrequently: true });
          if (!cx) throw new Error("No Context");

          cx.save();
          // Clip path before drawing the image so it doesn't render background bounds
          if (shape.dots && shape.dots.length > 0) {
            cx.beginPath();
            cx.moveTo(shape.dots[0].x, shape.dots[0].y);
            for (let i = 1; i < shape.dots.length; i++) {
              cx.lineTo(shape.dots[i].x, shape.dots[i].y);
            }
            cx.closePath();
            cx.clip();
          }

          if (shape.img && shape.img.trim() !== '') {
            try {
              const img = await loadImg(shape.img);
              cx.drawImage(img, 0, 0, shape.dims.width, shape.dims.height);
            } catch(e) {
              console.error("Rasterize img error:", e);
            }
          }

          if (shape.dots && shape.dots.length > 0) {
            if (shape.fillColor || shape.baseFill) {
              cx.fillStyle = shape.fillColor || shape.baseFill!;
              cx.fill();
            } else if (!shape.img) {
               // Only fill default blue if no image AND no fill exists
               cx.fillStyle = 'blue'; 
               cx.fill();
            }
          }
          cx.restore();

          // Mask out any erased regions from the raster
          if (shape.erasedPaths && shape.erasedPaths.length > 0) {
            cx.save();
            cx.globalCompositeOperation = 'destination-out';
            shape.erasedPaths.forEach(p => {
              const path2d = new Path2D(p);
              cx.fill(path2d);
            });
            cx.restore();
          }
          
          return { canvas: c, ctx: cx, data: cx.getImageData(0, 0, c.width, c.height) };
        };

        const [mRender, gRender] = await Promise.all([
          rasterizeShape(mannequin), 
          rasterizeShape(garment)
        ]);

        const canvas = document.createElement('canvas');
        canvas.width = mannequin.dims.width;
        canvas.height = mannequin.dims.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error("No Context");

        const mData = mRender.data;
        const gData = gRender.data;
        const outData = new ImageData(canvas.width, canvas.height);

        // Measure at armpit level like the old version (22% for mannequin, 40-60% for garment)
        const getMeasurement = (data: ImageData, width: number, height: number, label: string, measurePercent: number) => {
          let topY = -1;
          let bottomY = -1;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (data.data[(y * width + x) * 4 + 3] > 10) { 
                if (topY === -1) topY = y;
                bottomY = y;
                break; 
              }
            }
          }
          if (topY === -1) {
            console.log(`[${label}] No pixels found!`);
            return { y: 0, topY: 0, left: 0, right: 0, w: 0 };
          }

          const shapeHeight = bottomY - topY;
          const measureY = Math.min(height - 1, topY + Math.floor(shapeHeight * measurePercent));
          let sLeft = -1, sRight = -1;
          for (let x = 0; x < width; x++) {
            if (data.data[(measureY * width + x) * 4 + 3] > 10) {
              if (sLeft === -1) sLeft = x;
              sRight = x;
            }
          }
          const w = sRight - sLeft + 1;
          console.log(`[${label}] topY=${topY}, bottomY=${bottomY}, shapeHeight=${shapeHeight}, measureY=${measureY}, left=${sLeft}, right=${sRight}, w=${w}`);
          return { y: measureY, topY, left: sLeft, right: sRight, w };
        };

        // For garment, find the widest point between 20-50% to get armpit/bust area
        const getWidestMeasurement = (data: ImageData, width: number, height: number, label: string) => {
          let topY = -1;
          let bottomY = -1;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (data.data[(y * width + x) * 4 + 3] > 10) { 
                if (topY === -1) topY = y;
                bottomY = y;
                break; 
              }
            }
          }
          if (topY === -1) {
            console.log(`[${label}] No pixels found!`);
            return { y: 0, topY: 0, left: 0, right: 0, w: 0 };
          }

          const shapeHeight = bottomY - topY;
          let maxW = 0;
          let bestY = topY;
          let bestLeft = 0, bestRight = 0;
          
          // Scan from 20% to 50% of shape height to find widest point (armpit/bust area)
          const startY = topY + Math.floor(shapeHeight * 0.20);
          const endY = topY + Math.floor(shapeHeight * 0.50);
          
          for (let y = startY; y <= endY && y < height; y++) {
            let rowLeft = -1, rowRight = -1;
            for (let x = 0; x < width; x++) {
              if (data.data[(y * width + x) * 4 + 3] > 10) {
                if (rowLeft === -1) rowLeft = x;
                rowRight = x;
              }
            }
            if (rowLeft !== -1) {
              const rowW = rowRight - rowLeft + 1;
              if (rowW > maxW) {
                maxW = rowW;
                bestY = y;
                bestLeft = rowLeft;
                bestRight = rowRight;
              }
            }
          }
          
          console.log(`[${label}] topY=${topY}, widestY=${bestY}, left=${bestLeft}, right=${bestRight}, w=${maxW}`);
          return { y: bestY, topY, left: bestLeft, right: bestRight, w: maxW };
        };


        // Get shoulder Y position as 15% down from top (for both mannequin and garment)
        const getShoulderYFixed = (data: ImageData, width: number, height: number, label: string) => {
          let topY = -1;
          let bottomY = -1;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (data.data[(y * width + x) * 4 + 3] > 10) { 
                if (topY === -1) topY = y;
                bottomY = y;
                break; 
              }
            }
          }
          if (topY === -1) return { y: 0, topY: 0 };
          const shapeHeight = bottomY - topY;
          const shoulderY = topY + Math.floor(shapeHeight * 0.15);
          console.log(`[${label}] ShoulderY (15%): ${shoulderY}, topY=${topY}`);
          return { y: shoulderY, topY };
        };

        // Mannequin: measure at widest point (20-50%) for SIZING
        const mSh = getWidestMeasurement(mData, canvas.width, canvas.height, "Mannequin");
        // Garment: find widest point between 20-50% for SIZING
        const gSh = getWidestMeasurement(gData, gRender.canvas.width, gRender.canvas.height, "Garment");
        
        // For mannequin, shoulder is 7% down from top.
        const getShoulderY7 = (data: ImageData, width: number, height: number, label: string) => {
          let topY = -1;
          let bottomY = -1;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (data.data[(y * width + x) * 4 + 3] > 10) { 
                if (topY === -1) topY = y;
                bottomY = y;
                break; 
              }
            }
          }
          if (topY === -1) return { y: 0, topY: 0 };
          const shapeHeight = bottomY - topY;
          const shoulderY = topY + Math.floor(shapeHeight * 0.07);
          return { y: shoulderY, topY };
        };
        // Universal garment shoulder detection: scan for first row where width increases by 1.5x over top row
        // Also, always reset garment top to 0 before each drape to prevent cumulative drift
        const getGarmentShoulderY = (data: ImageData, width: number, height: number, label: string) => {
          let topY = -1;
          let bottomY = -1;
          let topRowWidth = 0;
          // Find the first non-transparent row (reset top to 0 for draping)
          let foundFirst = false;
          for (let y = 0; y < height; y++) {
            let rowLeft = -1, rowRight = -1;
            for (let x = 0; x < width; x++) {
              if (data.data[(y * width + x) * 4 + 3] > 10) {
                if (rowLeft === -1) rowLeft = x;
                rowRight = x;
              }
            }
            if (rowLeft !== -1 && !foundFirst) {
              foundFirst = true;
              // If the first non-transparent row is not at y=0, shift all rows up so topY=0
              if (y > 0) {
                // Shift all rows up by y
                const newData = new Uint8ClampedArray(data.data.length);
                for (let sy = y; sy < height; sy++) {
                  for (let sx = 0; sx < width; sx++) {
                    for (let c = 0; c < 4; c++) {
                      newData[((sy-y)*width+sx)*4+c] = data.data[(sy*width+sx)*4+c];
                    }
                  }
                }
                data.data.set(newData);
                topY = 0;
              } else {
                topY = y;
              }
              topRowWidth = rowRight - rowLeft + 1;
            }
            if (rowLeft !== -1) {
              bottomY = y;
            }
          }
          if (topY === -1 || topRowWidth === 0) return { y: 0, topY: 0 };
          // Scan for first row where width increases by 1.5x over top row
          for (let y = topY + 1; y < height; y++) {
            let rowLeft = -1, rowRight = -1;
            for (let x = 0; x < width; x++) {
              if (data.data[(y * width + x) * 4 + 3] > 10) {
                if (rowLeft === -1) rowLeft = x;
                rowRight = x;
              }
            }
            if (rowLeft !== -1) {
              const rowW = rowRight - rowLeft + 1;
              if (rowW > 1.5 * topRowWidth) {
                return { y: y - topY, topY: 0 };
              }
            }
          }
          // If not found, just use top
          return { y: 0, topY: 0 };
        };
        const mShoulder = getShoulderY7(mData, canvas.width, canvas.height, "Mannequin");
        const gShoulder = getGarmentShoulderY(gData, gRender.canvas.width, gRender.canvas.height, "Garment");

        // 1) resize dress by bust/armpit width globally first (proper sizing)
        const baseScale = (mSh.w > 0 && gSh.w > 0) ? mSh.w / gSh.w : 1;
        // Center calculated from actual left/right positions
        const mCenter = (mSh.left + mSh.right) / 2;
        const gCenter = (gSh.left + gSh.right) / 2;
        console.log(`baseScale: ${baseScale}, mShoulderY: ${mShoulder.y}, gShoulderY: ${gShoulder.y}`);

        let mappedPixels = 0;

        // Process row by row: position scaled garment, replace mannequin pixels where they overlap
        // Align garment TOP to mannequin TOP (since resize is based on bust/armpit width)
        for (let y = mSh.topY; y < canvas.height; y++) {
            // Find mannequin bounds for this row
            let mLeft = -1, mRight = -1;
            for (let x = 0; x < canvas.width; x++) {
                if (mData.data[(y * canvas.width + x) * 4 + 3] > 10) {
                    if (mLeft === -1) mLeft = x;
                    mRight = x;
                }
            }

            // Calculate corresponding row in the garment - align garment top (shoulder) to mannequin shoulder, then shift up by 15% of garment height
            // Align garment shoulder (y=0) to mannequin shoulder (mShoulder.y)
            const gy = Math.floor((y - mShoulder.y) / baseScale);

            if (gy >= 0 && gy < gRender.canvas.height) {
                // Find garment bounds for this row
                let gLeft = -1, gRight = -1;
                for (let gx = 0; gx < gRender.canvas.width; gx++) {
                    if (gData.data[(gy * gRender.canvas.width + gx) * 4 + 3] > 10) {
                        if (gLeft === -1) gLeft = gx;
                        gRight = gx;
                    }
                }

                if (gLeft !== -1 && gRight !== -1) {
                    const garmentRowWidth = gRight - gLeft + 1;
                    
                    // Calculate where this garment row maps to in output (using baseScale)
                    const scaledDrawLeft = mCenter + (gLeft - gCenter) * baseScale;
                    const scaledDrawRight = mCenter + (gRight - gCenter) * baseScale;
                    const scaledGarmentWidth = scaledDrawRight - scaledDrawLeft;

                    // Loop through scaled garment positions (not mannequin positions)
                    // This maintains the garment's natural pixel ratio without stretching
                    for (let x = Math.floor(scaledDrawLeft); x <= Math.floor(scaledDrawRight); x++) {
                        if (x >= 0 && x < canvas.width) {
                            // Map output x back to original garment x (1:1 with scale)
                            const ratio = (x - scaledDrawLeft) / scaledGarmentWidth;
                            const gx = Math.floor(gLeft + (ratio * garmentRowWidth));

                            if (gx >= 0 && gx < gRender.canvas.width) {
                                const gIdx = (gy * gRender.canvas.width + gx) * 4;

                                if (gData.data[gIdx + 3] > 0) {
                                    // Check if this position is on the mannequin OR is overflow
                                    const isOnMannequin = mLeft !== -1 && mRight !== -1 && x >= mLeft && x <= mRight;
                                    const isOverflow = mLeft === -1 || x < mLeft || x > mRight;
                                    
                                    if (isOnMannequin || isOverflow) {
                                        mappedPixels++;
                                        const outIdx = (y * canvas.width + x) * 4;
                                        outData.data[outIdx] = gData.data[gIdx];         // R
                                        outData.data[outIdx + 1] = gData.data[gIdx + 1]; // G
                                        outData.data[outIdx + 2] = gData.data[gIdx + 2]; // B
                                        outData.data[outIdx + 3] = gData.data[gIdx + 3]; // A
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`Mapped Pixels: ${mappedPixels}`);
        if (mappedPixels === 0) {
           console.error("NO PIXELS WERE MAPPED!");
        }

        ctx.putImageData(outData, 0, 0);

        await new Promise(r => setTimeout(r, 400));
        const resultUrl = canvas.toDataURL('image/png');

        saveForUndo();

        setWorkspaceShapes(prev => {
          const others = prev.filter(s => s.id !== garmentId);
          const garmentShape = prev.find(s => s.id === garmentId);
          if (!garmentShape) return prev;
          
          return [...others, {
            ...garmentShape,
            img: resultUrl,
            position: { ...mannequin.position },
            scale: mannequin.scale,
            dims: { ...mannequin.dims },
            isDrapingAnimated: true,
            zIndex: Math.max(...prev.map(s => s.zIndex || 0), 100) + 1,
            dots: [] // Vector points consumed entirely by raster outcome
          }];
        });

      } catch (err) {
        console.error(err);
        alert("Failed to drape! Check console.");
      } finally {
        setAiDraping({ active: false, text: "" });
      }
    } else {
      alert("Garment or Mannequin missing!");
    }
  };


  // START MANUAL NECK-TO-NECK DRAPING
  const startManualShoulderSelection = useCallback((garmentId?: string) => {
    const targetGarmentId = garmentId || selectedGarmentId;
    if (!targetGarmentId) return;
    
    const garment = workspaceShapes.find(s => s.id === targetGarmentId);
    const mannequin = workspaceShapes.find(s => s.isMannequin);
    
    if (!garment) {
      alert("Garment not found!");
      return;
    }
    
    if (!mannequin) {
      alert("Mannequin not found! Please add a dress form first.");
      return;
    }
    
    // Use user-provided measurements instead of auto-detection
    saveForUndo();
    
    // Calculate mannequin armpit points (between shoulder and bust, around 22% down)
    // Sort mannequin dots by Y to find the vertical range
    const mannequinDotsLocal = [...mannequin.dots].sort((a, b) => a.y - b.y);
    const mannequinTopY = mannequinDotsLocal[0].y;
    const mannequinBottomY = mannequinDotsLocal[mannequinDotsLocal.length - 1].y;
    const mannequinHeight = mannequinBottomY - mannequinTopY;
    
    // Armpit is typically around 22% down from top (between shoulder at 15% and bust at 30%)
    const mannequinArmpitY = mannequinTopY + (mannequinHeight * 0.22);
    
    // Find leftmost and rightmost dots near the armpit level (within 3% range)
    const armpitRange = mannequinHeight * 0.03;
    const armpitLevelDots = mannequinDotsLocal.filter(d => 
      Math.abs(d.y - mannequinArmpitY) < armpitRange
    );
    
    if (armpitLevelDots.length < 2) {
      alert("Could not find mannequin armpit points!");
      return;
    }
    
    const mannequinArmpitLeft = armpitLevelDots.reduce((left, dot) => dot.x < left.x ? dot : left, armpitLevelDots[0]);
    const mannequinArmpitRight = armpitLevelDots.reduce((right, dot) => dot.x > right.x ? dot : right, armpitLevelDots[0]);
    
    const mannequinArmpitLeftScreen = {
      x: mannequin.position.x + mannequinArmpitLeft.x * mannequin.scale,
      y: mannequin.position.y + mannequinArmpitLeft.y * mannequin.scale
    };
    const mannequinArmpitRightScreen = {
      x: mannequin.position.x + mannequinArmpitRight.x * mannequin.scale,
      y: mannequin.position.y + mannequinArmpitRight.y * mannequin.scale
    };
    
    const mannequinBustPixels = Math.hypot(
      mannequinArmpitRightScreen.x - mannequinArmpitLeftScreen.x,
      mannequinArmpitRightScreen.y - mannequinArmpitLeftScreen.y
    );
    
    // Measure garment's width in LOCAL coordinates
    const garmentDots = garment.dots;
    const garmentDotsLocal = garmentDots.map(d => ({ ...d })).sort((a, b) => a.y - b.y);
    
    // Get middle range (40-60%) for armpit/armhole measurement
    const topY = garmentDotsLocal[0].y;
    const bottomY = garmentDotsLocal[garmentDotsLocal.length - 1].y;
    const garmentHeightLocal = bottomY - topY;
    const armpitStartY = topY + (garmentHeightLocal * 0.4);
    const armpitEndY = topY + (garmentHeightLocal * 0.6);
    const armpitRangeDots = garmentDotsLocal.filter(d => d.y >= armpitStartY && d.y <= armpitEndY);
    
    const leftmostDot = armpitRangeDots.reduce((left, dot) => dot.x < left.x ? dot : left);
    const rightmostDot = armpitRangeDots.reduce((right, dot) => dot.x > right.x ? dot : right);
    
    // Calculate actual armpit-to-armpit distance of garment
    const garmentArmpitDistance = Math.hypot(
      rightmostDot.x - leftmostDot.x,
      rightmostDot.y - leftmostDot.y
    );
    
    // Scale based on actual distances
    const newScale = mannequinBustPixels / garmentArmpitDistance;
    const scaleRatio = newScale / garment.scale;
    
    // Position LEFT armpit to LEFT armpit point, with slight downward adjustment
    const leftOffsetX = leftmostDot.x;
    const leftOffsetY = leftmostDot.y;
    
    const newLeftOffsetX = leftOffsetX * newScale;
    const newLeftOffsetY = leftOffsetY * newScale;
    
    // Add small downward adjustment (about 5% of mannequin height)
    const downwardAdjustment = mannequinHeight * mannequin.scale * 0.05;
    
    const newPosition = {
      x: mannequinArmpitLeftScreen.x - newLeftOffsetX,
      y: mannequinArmpitLeftScreen.y - newLeftOffsetY + downwardAdjustment
    };
    
    console.log("✅ Draping complete - armpit to armpit alignment");
    
    setWorkspaceShapes(prev => prev.map(s => 
      s.id === targetGarmentId 
        ? { ...s, position: newPosition, scale: newScale, showDots: true, isGarment: true }
        : s
    ));
    
    setShowDrapeModal(false);
    setSelectedGarmentId(null);
  }, [selectedGarmentId, workspaceShapes, saveForUndo, armpitMeasurement, garmentLength]);

  const calculateMannequinDots = (baseWidth: number, baseHeight: number, measures: MannequinMeasurements) => {
    const centerX = baseWidth / 2;
    const bustScale = measures.bust / 92;
    const underBustScale = measures.underBust / 78;
    const waistScale = measures.waist / 68;
    const hipScale = measures.hips / 98;
    const shoulderScale = measures.shoulderWidth / 38;
    const neckY = baseHeight * 0.08;
    const shoulderY = baseHeight * 0.15;
    const bustY = baseHeight * 0.30;
    const underBustY = baseHeight * 0.40;
    const waistY = baseHeight * 0.52;
    const hipY = baseHeight * 0.72;
    const bottomY = baseHeight * 0.88;
    const neckWidth = baseWidth * 0.20;
    const shoulderWidth = baseWidth * 0.45 * shoulderScale;
    const bustWidth = baseWidth * 0.42 * bustScale;
    const underBustWidth = baseWidth * 0.38 * underBustScale;
    const waistWidth = baseWidth * 0.28 * waistScale;
    const hipWidth = baseWidth * 0.44 * hipScale;
    const bottomWidth = baseWidth * 0.40 * hipScale;
    return [
      { id: 'neck-left', x: centerX - neckWidth/2, y: neckY },
      { id: 'neck-right', x: centerX + neckWidth/2, y: neckY },
      { id: 'shoulder-right', x: centerX + shoulderWidth/2, y: shoulderY },
      { id: 'bust-right-top', x: centerX + bustWidth/2, y: bustY - 20 },
      { id: 'bust-right', x: centerX + bustWidth/2, y: bustY },
      { id: 'bust-right-bottom', x: centerX + bustWidth/2, y: bustY + 20 },
      { id: 'underbust-right', x: centerX + underBustWidth/2, y: underBustY },
      { id: 'waist-right', x: centerX + waistWidth/2, y: waistY },
      { id: 'hip-right-top', x: centerX + hipWidth/2, y: hipY - 20 },
      { id: 'hip-right', x: centerX + hipWidth/2, y: hipY },
      { id: 'hip-right-bottom', x: centerX + hipWidth/2, y: hipY + 20 },
      { id: 'bottom-right', x: centerX + bottomWidth/2, y: bottomY },
      { id: 'bottom-center', x: centerX, y: bottomY + 10 },
      { id: 'bottom-left', x: centerX - bottomWidth/2, y: bottomY },
      { id: 'hip-left-bottom', x: centerX - hipWidth/2, y: hipY + 20 },
      { id: 'hip-left', x: centerX - hipWidth/2, y: hipY },
      { id: 'hip-left-top', x: centerX - hipWidth/2, y: hipY - 20 },
      { id: 'waist-left', x: centerX - waistWidth/2, y: waistY },
      { id: 'underbust-left', x: centerX - underBustWidth/2, y: underBustY },
      { id: 'bust-left-bottom', x: centerX - bustWidth/2, y: bustY + 20 },
      { id: 'bust-left', x: centerX - bustWidth/2, y: bustY },
      { id: 'bust-left-top', x: centerX - bustWidth/2, y: bustY - 20 },
      { id: 'shoulder-left', x: centerX - shoulderWidth/2, y: shoulderY },
    ];
  };

  const addShapeToCanvas = useCallback((type: 'square' | 'circle' | 'triangle' | 'star' | 'heart' | 'line' | 'curve' | 'oval' | 'emerald' | 'pear' | 'marquise' | 'bead' | 'button' | 'real-emerald' | 'real-bead' | string) => {
    saveForUndo();
    const cx = 200;
    const cy = 200;
    const size = 150;
    const pts: { id: string; x: number; y: number }[] = [];
    
    // Check if asset shape (from /api/assets)
    if (type.startsWith('asset:')) {
      const filename = type.split(':')[1];
      const assetPath = `/assets/${filename}`;
      
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        
        // Use natural dimensions if available, otherwise fallback
        if (!w || !h) {
           w = 200; h = 200;
        }

        const pts2: { id: string; x: number; y: number }[] = [];
        pts2.push({ id: `pt-${Date.now()}-1`, x: cx - w/2, y: cy - h/2 });
        pts2.push({ id: `pt-${Date.now()}-2`, x: cx + w/2, y: cy - h/2 });
        pts2.push({ id: `pt-${Date.now()}-3`, x: cx + w/2, y: cy + h/2 });
        pts2.push({ id: `pt-${Date.now()}-4`, x: cx - w/2, y: cy + h/2 });
        
        const newStroke: Stroke = {
          id: `st-${Date.now()}`,
          points: pts2,
          color: 'transparent',
          width: 0,
          fillColor: 'transparent',
          baseFill: undefined,
          closed: true,
          clothType: type, // Stores 'asset:filename.png'
          zIndex: strokes.length + workspaceShapes.length + 1
        };
        setStrokes(prev => [...prev, newStroke]);
      };
      
      img.onerror = () => {
        // Fallback if load fails
        const w = 200; 
        const h = 200;
        const pts2: { id: string; x: number; y: number }[] = [];
        pts2.push({ id: `pt-${Date.now()}-1`, x: cx - w/2, y: cy - h/2 });
        pts2.push({ id: `pt-${Date.now()}-2`, x: cx + w/2, y: cy - h/2 });
        pts2.push({ id: `pt-${Date.now()}-3`, x: cx + w/2, y: cy + h/2 });
        pts2.push({ id: `pt-${Date.now()}-4`, x: cx - w/2, y: cy + h/2 });

        const newStroke: Stroke = {
            id: `st-${Date.now()}`,
            points: pts2,
            color: 'transparent',
            width: 0,
            fillColor: 'transparent',
            baseFill: undefined,
            closed: true,
            clothType: type,
            zIndex: strokes.length + workspaceShapes.length + 1
        };
        setStrokes(prev => [...prev, newStroke]);
      };

      img.src = assetPath;
      
      setShowShapesModal(false);
      return;
    }

    // Check if real image shapes
    if (type === 'real-bead' || type === 'real-emerald') {
      // Adjusted dimensions to match specific aspect ratios of assets
      const w = type === 'real-bead' ? 60 : 40; 
      const h = type === 'real-bead' ? 60 : 55; // Emerald isn't perfectly 2:3, slight adjust
      pts.push({ id: `pt-${Date.now()}-1`, x: cx - w/2, y: cy - h/2 });
      pts.push({ id: `pt-${Date.now()}-2`, x: cx + w/2, y: cy - h/2 });
      pts.push({ id: `pt-${Date.now()}-3`, x: cx + w/2, y: cy + h/2 });
      pts.push({ id: `pt-${Date.now()}-4`, x: cx - w/2, y: cy + h/2 });
      
      const newStroke: Stroke = {
        id: `st-${Date.now()}`,
        points: pts,
        color: 'transparent',
        width: 0,
        fillColor: 'transparent', // Ensure fill is transparent
        baseFill: undefined, // Ensure no base fill
        closed: true,
        clothType: type,
        zIndex: strokes.length + workspaceShapes.length + 1
      };
      setStrokes(prev => [...prev, newStroke]);
      setShowShapesModal(false);
      return;
    }

    // For Button, we create a group of shapes
    if (type === 'button') {
        const buttonId = `grp-${Date.now()}`;
        const newStrokes: Stroke[] = [];
        
        // Main body
        const bodyPts: { id: string; x: number; y: number }[] = [];
        for (let i = 0; i < 36; i++) {
            const angle = (i / 36) * Math.PI * 2;
            bodyPts.push({ id: `btn-b-${i}`, x: cx + Math.cos(angle) * (size/2), y: cy + Math.sin(angle) * (size/2) });
        }
        newStrokes.push({
            id: `st-${Date.now()}-body`,
            points: bodyPts,
            color: activeColor,
            width: 4,
            closed: true,
            baseFill: '#ffffff',
            fillColor: activeColor,
            groupId: buttonId,
            zIndex: 1
        });

        // 4 Holes
        const holeOffset = size * 0.15;
        const holeSize = size * 0.05;
        const holes = [
            { x: cx - holeOffset, y: cy - holeOffset },
            { x: cx + holeOffset, y: cy - holeOffset },
            { x: cx - holeOffset, y: cy + holeOffset },
            { x: cx + holeOffset, y: cy + holeOffset }
        ];

        holes.forEach((h, idx) => {
            const hPts = [];
            for (let i = 0; i < 12; i++) {
                const angle = (i / 12) * Math.PI * 2;
                hPts.push({ id: `btn-h-${idx}-${i}`, x: h.x + Math.cos(angle) * holeSize, y: h.y + Math.sin(angle) * holeSize });
            }
            newStrokes.push({
                id: `st-${Date.now()}-h-${idx}`,
                points: hPts,
                color: '#rgba(0,0,0,0.5)', 
                width: 2,
                closed: true,
                baseFill: '#333333', // Dark hole
                groupId: buttonId,
                zIndex: 2
            });
        });
        
        setStrokes(prev => [...prev, ...newStrokes]);
        setShowShapesModal(false);
        return;
    }

    if (type === 'square') {
      pts.push({ id: `pt-${Date.now()}-1`, x: cx - size/2, y: cy - size/2 });
      pts.push({ id: `pt-${Date.now()}-2`, x: cx + size/2, y: cy - size/2 });
      pts.push({ id: `pt-${Date.now()}-3`, x: cx + size/2, y: cy + size/2 });
      pts.push({ id: `pt-${Date.now()}-4`, x: cx - size/2, y: cy + size/2 });
    } else if (type === 'circle' || type === 'bead') {
      const numPoints = 36;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        pts.push({
          id: `pt-${Date.now()}-${i}`,
          x: cx + Math.cos(angle) * (size/2),
          y: cy + Math.sin(angle) * (size/2)
        });
      }
    } else if (type === 'oval') {
      const numPoints = 36;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        pts.push({
          id: `pt-${Date.now()}-${i}`,
          x: cx + Math.cos(angle) * (size/2) * 0.7, // Slimmer width
          y: cy + Math.sin(angle) * (size/2)
        });
      }
    } else if (type === 'emerald') {
      // Octagon (Emerald cut)
      const w = size * 0.4;
      const h = size * 0.6;
      const c = size * 0.1; // corner cut size
      pts.push({ id: `pt-em-1`, x: cx - w + c, y: cy - h });
      pts.push({ id: `pt-em-2`, x: cx + w - c, y: cy - h });
      pts.push({ id: `pt-em-3`, x: cx + w, y: cy - h + c });
      pts.push({ id: `pt-em-4`, x: cx + w, y: cy + h - c });
      pts.push({ id: `pt-em-5`, x: cx + w - c, y: cy + h });
      pts.push({ id: `pt-em-6`, x: cx - w + c, y: cy + h });
      pts.push({ id: `pt-em-7`, x: cx - w, y: cy + h - c });
      pts.push({ id: `pt-em-8`, x: cx - w, y: cy - h + c });
    } else if (type === 'pear') {
      // Teardrop / Pear shape (Pointed top, rounded bottom)
      const numPoints = 40;
      for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 2;
        // Standard teardrop parametric: x = cos(t), y = sin(t) * sin(t/2)^m
        // Rotated -90deg to point up? Or just swap x/y.
        // Let's use a simple bezier approximation or specific point distribution for better shape
        // A simple "egg" with a pointed top:
        // Top point (0, -h), Bottom (0, h), Width (+w, 0)
        // Let's manually define a path or use a modified ellipse.
        
        // Using parametric:
        // x = a * sin(t)
        // y = -b * cos(t)  -- this is ellipse.
        // Pack bottom heavier?
        // y = -b * cos(t) (1 - 0.5*sin(t)) ? No.
        
        // Better Teardrop:
        // x = s * 0.5 * (1 - Math.cos(t)) * Math.sin(t)
        // y = s * 0.5 * (1 - Math.cos(t)) * Math.cos(t) -- Rotated 
        
        // Actually simpler:
        const angle = t - Math.PI / 2; // Start from top
        const stretch = Math.sin(t/2); // 0 at top? No.
        
        // Let's just use top point and interpolate to a circle at bottom.
        const px = cx + size * 0.4 * Math.sin(t);
        const py = cy - size * 0.5 * Math.cos(t) + (size * 0.2 * Math.max(0, Math.cos(t))); // Flatten top? No.
        
        // Let's use this known parametric for teardrop (point up):
        // x = cos(t) * sin(t)^m ...
        
        // Let's stick to the user request "as is". The user provided an image. 
        // I will use a path that mimics that specific pear cut geometry.
        // Top point, rounded bottom.
        let x, y;
        // Top half (pointy)
        // Bottom half (round)
        
        // Let's use a custom set of points for a perfect pear cut look
        // t goes 0 to 2PI. 0 is top (0, -1)
        
        // Modified circle: 
        // x = R * sin(t)
        // y = -R * cos(t) (but stretched at top)
        
        // If y < 0 (top half), pinch x.
        const sinT = Math.sin(t);
        const cosT = Math.cos(t);
        
        x = cx + (size * 0.35) * sinT;
        y = cy - (size * 0.5) * cosT;
        
        // Sharpen the top (where cosT is close to 1, i.e., t near 0 or 2PI)
        if (y < cy) {
           x = x * (1 - 0.4 * Math.abs(cosT)); // Pinch x as we go up
        }
        
        pts.push({ id: `pt-pr-${i}`, x, y });
      }
    } else if (type === 'marquise') {
      const numPoints = 30;
      for (let i = 0; i <= numPoints; i++) {
        const t = (i / numPoints) * Math.PI;
         // Top curve
        pts.push({ id: `pt-mq-t${i}`, x: cx + size*0.3 * Math.sin(t), y: cy - size/2 * Math.cos(t) });
      }
      for (let i = 0; i <= numPoints; i++) {
         const t = (i / numPoints) * Math.PI;
         // Bottom curve (mirrored x) - wait, marquise is two arcs
         // Let's us simple math: x = a * sin(t), y = b * cos(t) is ellipse.
         // Marquise is intersection of two circles.
         // Simpler: Just scale a sine wave?
         // Actually, let's just use a squashed ellipse rotated 45 deg or pointed ends?
         // Pointed ends:
         // x = w * sin(t), y = h * cos(t) but clip?
         // Let's use 2 Quadratic curves manually if I could, but here points...
         // Let's stick to a thin oval with pointed tips
         const angle = (i / numPoints) * Math.PI * 2;
         const x = cx + size * 0.3 * Math.sin(angle); // width
         const y = cy + size * 0.6 * Math.cos(angle); // height
         // Determine if close to tip to sharpen?
         // Nah, standard marquise is lens shape.
         // Lens: Intersection of 2 circles.
         // Let's do a simple lens approximation
      }
      // Overwrite for marquise proper
      pts.length = 0;
      for (let i=0; i<20; i++) {
         const t = i/20;
         pts.push({ id: `mq1-${i}`, x: cx + size*0.35 * Math.sin(t*Math.PI), y: cy - size/2 + size*t });
      }
      for (let i=0; i<20; i++) {
        const t = i/20;
        pts.push({ id: `mq2-${i}`, x: cx + size*0.35 * Math.sin((1-t)*Math.PI), y: cy + size/2 - size*t });
      }
      // Better math: x = 0.5 * w * (1 - t^2), y = h * t ... ?
      // Let's go with a simple Diamond (Rhombus) for now, or the user can distort a Circle/Oval.
      // Actually, Rhombus is easier and looks like Marquise if curved.
      // Let's do Rhombus but with slight curve.
      pts.length = 0;
      const steps = 10;
      for (let i=0; i<=steps; i++) { // Right side
          const y = cy - size/2 + (size/steps)*i;
          const x = cx + size*0.3 * Math.sin((i/steps)*Math.PI);
          pts.push({ id: `mq-${i}`, x, y });
      }
      for (let i=0; i<=steps; i++) { // Left side
          const y = cy + size/2 - (size/steps)*i;
          const x = cx - size*0.3 * Math.sin((i/steps)*Math.PI);
          pts.push({ id: `mq-b-${i}`, x, y });
      }
    } else if (type === 'triangle') {
      pts.push({ id: `pt-${Date.now()}-1`, x: cx, y: cy - size/2 });
      pts.push({ id: `pt-${Date.now()}-2`, x: cx + size/2, y: cy + size/2 });
      pts.push({ id: `pt-${Date.now()}-3`, x: cx - size/2, y: cy + size/2 });
    } else if (type === 'star') {
      const numPoints = 10;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2 - Math.PI / 2;
        const radius = i % 2 === 0 ? size/2 : size/4;
        pts.push({
          id: `pt-${Date.now()}-${i}`,
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius
        });
      }
    } else if (type === 'heart') {
      const numPoints = 30;
      for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 2;
        // Heart curve equations
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));
        pts.push({
          id: `pt-${Date.now()}-${i}`,
          x: cx + x * (size/35),
          y: cy + y * (size/35)
        });
      }
    } else if (type === 'line') {
      pts.push({ id: `pt-${Date.now()}-1`, x: cx - size/2, y: cy });
      pts.push({ id: `pt-${Date.now()}-2`, x: cx + size/2, y: cy });
    } else if (type === 'curve') {
      const numPoints = 20;
      for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const x = (1 - t) * (1 - t) * (cx - size/2) + 2 * (1 - t) * t * cx + t * t * (cx + size/2);
        const y = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * (cy - size) + t * t * cy;
        pts.push({
          id: `pt-${Date.now()}-${i}`,
          x,
          y
        });
      }
    }

    const isGem = ['emerald', 'pear', 'marquise', 'oval'].includes(type);
    const newStroke: Stroke = {
      id: `st-${Date.now()}`,
      points: pts,
      color: activeColor,
      width: isGem ? 2 : 4,
      closed: type !== 'line' && type !== 'curve',
      baseFill: (type !== 'line' && type !== 'curve' && !isGem) ? '#ffffff' : undefined,
      fillColor: isGem ? activeColor : undefined,
      clothType: isGem ? 'gem' : (selectedClothType || undefined)
    };
    
    setStrokes(prev => [...prev, newStroke]);
    setShowShapesModal(false);
  }, [activeColor, saveForUndo, selectedClothType]);

  const createMannequinWithMeasurements = useCallback((measures: MannequinMeasurements) => {
    saveForUndo();
    const mannequinImagePath = '/mannequin.png';
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const baseWidth = img.width;
      const baseHeight = img.height;
      const mannequinDots = calculateMannequinDots(baseWidth, baseHeight, measures);
      
      // Adjust position and scale for mobile
      const isMobile = window.innerWidth < 768;
      const posX = isMobile ? 50 : 150;
      const posY = isMobile ? 20 : 30;
      const scaleValue = isMobile ? 0.25 : 0.45;
      
      const mannequinShape: DistortableShape = {
        id: `mannequin-${Date.now()}`,
        img: mannequinImagePath,
        dots: mannequinDots,
        dims: { width: baseWidth, height: baseHeight },
        position: { x: posX, y: posY },
        scale: scaleValue,
        showDots: false,
        fillColor: undefined,
        erasedPaths: [],
        isMannequin: true
      };
      setWorkspaceShapes(prev => [...prev, mannequinShape]);
      setShowMannequinModal(false);
    };
    img.onerror = () => { alert('Could not load mannequin image. Make sure /public/mannequin.png exists!'); };
    img.src = mannequinImagePath;
  }, [saveForUndo]);

  const tutorialSteps = [
    { text: "Select a template...", target: "template-0" },
    { text: "Open Tracing...", target: "trace-btn" },
    { text: "Choose paths...", target: "trace-svg-container", action: "choose" },
    { text: "Add to Canvas!", target: "add-btn" },
    { text: "Drag a dot to reshape!", target: "workspace-dot-0", action: "drag_dot" },
    { text: "Select Pen Tool", target: "pen-tool" },
    { text: "Draw something!", target: "workspace-svg", action: "draw" },
    { text: "Change color", target: "color-picker" },
    { text: "Select Fill Tool", target: "fill-tool" },
    { text: "Fill the shape", target: "workspace-svg", action: "fill_shape" },
    { text: "Select Erase Tool", target: "erase-tool" },
    { text: "Erase part of it", target: "workspace-svg", action: "erase_action" },    
    { text: "Right-click for Menu", target: "workspace-svg", action: "context_menu" },
    { text: "Add a Dress Form!", target: "dress-form-btn", action: "open_mannequin_modal" },
    { text: "Adjust measurements", target: "bust-slider", action: "adjust_slider" },
    { text: "Add Mannequin!", target: "add-mannequin-btn" },
    { text: "Right-click garment!", target: "workspace-svg", action: "context_menu_garment" },
    { text: "Click Drape option!", target: "drape-menu-btn", action: "click_drape" },
    { text: "Bringing garment forward...", target: "workspace-svg", action: "bring_garment_front" },
    { text: "Hide the dots", target: "dots-btn" },
    { text: "Lock movement", target: "lock-btn" },
    { text: "Reset Canvas", target: "reset-btn" },
    { text: "Lastly, Undo everything!", target: "undo-btn" }
  ];

  const runTutorial = async () => {
    console.log('runTutorial called');
    
    // Ask user for confirmation
    const userConfirmed = confirm("I am starting a tutorial and need to reset the canvas. Do you want to continue?");
    console.log('User confirmed:', userConfirmed);
    
    if (!userConfirmed) {
      return;
    }
    
    // Reset canvas
    console.log('Resetting canvas...');
    setWorkspaceShapes([]);
    setStrokes([]);
    setContextMenu(null);
    
    // Show dots
    console.log('Showing dots...');
    setGlobalShowDots(true);
    
    // Unlock screen
    console.log('Unlocking screen...');
    setIsLocked(false);
    
    // Select second template (template-1)
    console.log('Selecting template...');
    const template1 = document.getElementById('template-1');
    console.log('Template element:', template1);
    if (template1) {
      template1.click();
    }
    await new Promise(r => setTimeout(r, 300));
    
    // Disable tutorial button
    console.log('Disabling tutorial button...');
    setTutorialDisabled(true);
    
    console.log('Starting tutorial animation...');
    setGhostCursor({ x: window.innerWidth / 2, y: window.innerHeight / 2, active: true, clicking: false });

    for (let i = 0; i < tutorialSteps.length; i++) {
      const step = tutorialSteps[i];
      setTutorialStep(i);
      const el = document.getElementById(step.target);
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      let startX = rect.left + rect.width / 2;
      let startY = rect.top + rect.height / 2;

      setGhostCursor({ x: startX, y: startY, active: true, clicking: false });
      await new Promise(r => setTimeout(r, 800));
      setGhostCursor(prev => ({ ...prev, clicking: true }));

      if (step.action === "drag_dot") {
        saveForUndo();
        
        // Use deep clone and direct mutation - simpler approach
        for (let j = 0; j < 10; j++) {
          setWorkspaceShapes(prev => {
            const cloned = JSON.parse(JSON.stringify(prev)) as DistortableShape[];
            const lastShape = cloned[cloned.length - 1];
            
            if (lastShape && lastShape.dots.length >= 4) {
              // Move dots with large increments
              lastShape.dots[0].x += 5;
              lastShape.dots[0].y -= 3;
              lastShape.dots[1].x += 6;
              lastShape.dots[1].y += 2;
              lastShape.dots[2].x -= 4;
              lastShape.dots[2].y += 5;
              lastShape.dots[3].x += 3;
              lastShape.dots[3].y += 6;
            }
            
            return cloned;
          });
          
          await new Promise(r => setTimeout(r, 120));
        }
      }
      else if (step.action === "draw") {
        saveForUndo();
        const sid = `tuto-stroke`;
        const svgRect = workspaceRef.current?.getBoundingClientRect();
        if (!svgRect) continue;
        const startDrawX = 200;
        const startDrawY = 200;
        setStrokes(prev => [...prev, { id: sid, points: [{ id: 'p1', x: startDrawX, y: startDrawY }], color: activeColor, width: 6 }]);
        for(let j=0; j<10; j++) {
          await new Promise(r => setTimeout(r, 50));
          const newX = startDrawX + (j * 15);
          const newY = startDrawY + (Math.sin(j) * 20);
          setGhostCursor({ x: svgRect.left + newX, y: svgRect.top + newY, active: true, clicking: true });
          setStrokes(p => p.map(s => s.id === sid ? { ...s, points: [...s.points, { id: `pt-${j}`, x: newX, y: newY }] } : s));
        }
      }
        else if (step.action === "fill_shape") {
        saveForUndo();
        setStrokes(prev => prev.map(s => s.id === "tuto-stroke" ? { ...s, ...(keepOriginalColor ? {} : { baseFill: '#ffffff' }), fillColor: hexToRgba(activeColor, activeFillOpacity), clothType: normalizeFabric(selectedClothType) } : s));
      }
      else if (step.action === "erase_action") {
        saveForUndo();
        const svgRect = workspaceRef.current?.getBoundingClientRect();
        if (!svgRect) continue;
        for(let j=0; j<8; j++) {
          const ex = 220 + (j * 12);
          const ey = 210;
          sweepErase(ex, ey);
          setGhostCursor({ x: svgRect.left + ex, y: svgRect.top + ey, active: true, clicking: true });
          await new Promise(r => setTimeout(r, 80));
        }
      }
      else if (step.action === "context_menu") {
        // Find the drawn stroke element to right-click on
        const strokePath = workspaceRef.current?.querySelector('path[stroke]');
        if (strokePath) {
          const strokeRect = strokePath.getBoundingClientRect();
          const strokeCenterX = strokeRect.left + strokeRect.width / 2;
          const strokeCenterY = strokeRect.top + strokeRect.height / 2;
          setGhostCursor({ x: strokeCenterX, y: strokeCenterY, active: true, clicking: false });
          await new Promise(r => setTimeout(r, 500));
          setGhostCursor(prev => ({ ...prev, clicking: true }));
          strokePath.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, clientX: strokeCenterX, clientY: strokeCenterY
          }));
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      else if (step.action === "open_mannequin_modal") {
        el.click();
        await new Promise(r => setTimeout(r, 1500));
      }
      else if (step.action === "adjust_slider") {
        const slider = document.getElementById('bust-slider') as HTMLInputElement;
        if (slider) {
          const startValue = parseInt(slider.value);
          const endValue = 105;
          for (let j = 0; j <= 10; j++) {
            await new Promise(r => setTimeout(r, 80));
            const newValue = Math.round(startValue + ((endValue - startValue) * (j / 10)));
            slider.value = newValue.toString();
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
      else if (step.action === "context_menu_garment") {
        // Right-click on the FIRST image (the template that was added, not the mannequin)
        setContextMenu(null);
        await new Promise(r => setTimeout(r, 300));
        
        // Get the very first shape in the workspace (the traced template)
        const currentShapes = workspaceShapesRef.current;
        if (currentShapes.length > 0 && !currentShapes[0].isMannequin) {
          const garment = currentShapes[0];
          // Calculate center of garment
          const garmentCenterX = garment.position.x + (garment.dims.width * garment.scale) / 2;
          const garmentCenterY = garment.position.y + (garment.dims.height * garment.scale) / 2;
          
          const svgRect = workspaceRef.current?.getBoundingClientRect();
          if (svgRect) {
            const screenX = svgRect.left + garmentCenterX;
            const screenY = svgRect.top + garmentCenterY;
            
            setGhostCursor({ x: screenX, y: screenY, active: true, clicking: false });
            await new Promise(r => setTimeout(r, 500));
            setGhostCursor(prev => ({ ...prev, clicking: true }));
            
            // Trigger context menu
            setContextMenu({ x: screenX, y: screenY, id: garment.id, type: "shape" });
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }
      else if (step.action === "click_drape") {
        // Click the drape button - get the first garment shape
        await new Promise(r => setTimeout(r, 800));
        const currentShapes = workspaceShapesRef.current;
        const garment = currentShapes.find(s => !s.isMannequin);
        
        if (garment) {
          // Set the selected garment ID first
          setSelectedGarmentId(garment.id);
          await new Promise(r => setTimeout(r, 100));
          
          const drapeBtn = document.getElementById("drape-menu-btn");
          if (drapeBtn) {
            drapeBtn.click();
          }
        }
        setContextMenu(null);
        await new Promise(r => setTimeout(r, 1500));
      }
      else if (step.action === "bring_garment_front") {
        // Bring the garment to front so it appears over the mannequin
        await new Promise(r => setTimeout(r, 500));
        const currentShapes = workspaceShapesRef.current;
        const garment = currentShapes.find(s => !s.isMannequin);
        
        if (garment) {
          bringToFront(garment.id, "shape");
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      else {
        if (step.action === "choose") {
          const targetPath = document.elementFromPoint(startX, startY);
          if (targetPath?.tagName === 'path') targetPath.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } else {
          el.click();
        }
      }

      await new Promise(r => setTimeout(r, 700));
      setGhostCursor(prev => ({ ...prev, clicking: false }));
      await new Promise(r => setTimeout(r, 400));
    }

    setTutorialStep(null);
    setGhostCursor(p => ({ ...p, active: false }));
    setTutorialDisabled(false);
    
    // Prompt user to reset after tutorial
    setTimeout(() => {
      if (confirm("Tutorial complete! Click OK to reset the canvas and start fresh.")) {
        // Reset to initial state
        saveForUndo();
        setWorkspaceShapes([]);
        setStrokes([]);
        setActiveTool("cursor");
        setGlobalShowDots(true);
        setIsLocked(false);
      }
    }, 500);
  };

  const getBoundingBox = useCallback((item: DistortableShape | Stroke) => {
    if ('dots' in item) {
      const shape = item as DistortableShape;
      const xs = shape.dots.map(d => shape.position.x + d.x * shape.scale);
      const ys = shape.dots.map(d => shape.position.y + d.y * shape.scale);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    } else {
      const stroke = item as Stroke;
      const xs = stroke.points.map(p => p.x);
      const ys = stroke.points.map(p => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
  }, []);

  const isItemInRect = useCallback((bbox: { x: number; y: number; width: number; height: number }, rect: { x1: number; y1: number; x2: number; y2: number }) => {
    const rectX = Math.min(rect.x1, rect.x2);
    const rectY = Math.min(rect.y1, rect.y2);
    const rectW = Math.abs(rect.x2 - rect.x1);
    const rectH = Math.abs(rect.y2 - rect.y1);
    return bbox.x < rectX + rectW && bbox.x + bbox.width > rectX && bbox.y < rectY + rectH && bbox.y + bbox.height > rectY;
  }, []);

  const createGroupFromSelection = useCallback(() => {
    if (!selectionRect) return;
    saveForUndo();
    const groupId = `grp-${Date.now()}`;
    
    // Mark all shapes in rectangle with groupId
    setWorkspaceShapes(prev => prev.map(shape => {
      const bbox = getBoundingBox(shape);
      if (isItemInRect(bbox, selectionRect)) {
        return { ...shape, groupId };
      }
      return shape;
    }));
    
    // Mark all strokes in rectangle with groupId
    setStrokes(prev => prev.map(stroke => {
      const bbox = getBoundingBox(stroke);
      if (isItemInRect(bbox, selectionRect)) {
        return { ...stroke, groupId };
      }
      return stroke;
    }));
    
    setSelectionRect(null);
    setContextMenu(null);
  }, [selectionRect, workspaceShapes, strokes, getBoundingBox, isItemInRect, saveForUndo]);

  const ungroupItemsFromSelection = useCallback(() => {
    if (!selectionRect) return;
    saveForUndo();
    
    // Find all unique groupIds in the selection
    const groupIds = new Set<string>();
    workspaceShapes.forEach(shape => {
      const bbox = getBoundingBox(shape);
      if (isItemInRect(bbox, selectionRect) && shape.groupId) {
        groupIds.add(shape.groupId);
      }
    });
    strokes.forEach(stroke => {
      const bbox = getBoundingBox(stroke);
      if (isItemInRect(bbox, selectionRect) && stroke.groupId) {
        groupIds.add(stroke.groupId);
      }
    });
    
    // Remove groupId from all items that have these groupIds
    groupIds.forEach(groupId => {
      setWorkspaceShapes(prev => prev.map(s => s.groupId === groupId ? { ...s, groupId: undefined } : s));
      setStrokes(prev => prev.map(st => st.groupId === groupId ? { ...st, groupId: undefined } : st));
    });
    
    setSelectionRect(null);
    setContextMenu(null);
  }, [selectionRect, workspaceShapes, strokes, getBoundingBox, isItemInRect, saveForUndo]);

  const copyFromSelection = useCallback(async () => {
    if (!selectionRect) return;
    try {
      // Copy actual vector shapes and strokes in selection
      const shapesToCopy = workspaceShapes.filter(shape => {
        const bbox = getBoundingBox(shape);
        return isItemInRect(bbox, selectionRect);
      });
      const strokesToCopy = strokes.filter(stroke => {
        const bbox = getBoundingBox(stroke);
        return isItemInRect(bbox, selectionRect);
      });
      if (shapesToCopy.length === 0 && strokesToCopy.length === 0) return;
      // Deep clone to avoid reference issues
      const shapesCopy = JSON.parse(JSON.stringify(shapesToCopy));
      const strokesCopy = JSON.parse(JSON.stringify(strokesToCopy));
      setClipboard({ shapes: shapesCopy, strokes: strokesCopy });
      console.log('Copied vector shapes and strokes to clipboard');
    } catch (error) {
      console.error('Copy failed:', error);
    }
    setSelectionRect(null);
    setContextMenu(null);
  }, [selectionRect, workspaceShapes, strokes, getBoundingBox, isItemInRect]);

  const extractSelection = useCallback(async (asJpeg = false) => {
    if (!selectionRect) return;
    try {
      const rectX = Math.min(selectionRect.x1, selectionRect.x2);
      const rectY = Math.min(selectionRect.y1, selectionRect.y2);
      const rectW = Math.abs(selectionRect.x2 - selectionRect.x1);
      const rectH = Math.abs(selectionRect.y2 - selectionRect.y1);
      if (rectW < 5 || rectH < 5) return;

      const svgEl = workspaceRef.current;
      if (!svgEl) return;

      const clone = svgEl.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll('circle[data-control-dot]').forEach(d => d.remove());
      clone.querySelectorAll('rect[stroke="#3b82f6"]').forEach(d => d.remove());
      
      clone.setAttribute('viewBox', `${rectX} ${rectY} ${rectW} ${rectH}`);
      clone.setAttribute('width', `${rectW}`);
      clone.setAttribute('height', `${rectH}`);

      const images = Array.from(clone.querySelectorAll('image')) as SVGImageElement[];
      for (const imgEl of images) {
        const href = imgEl.getAttribute('href') || imgEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        if (!href) continue;
        try {
          if (href.startsWith('data:')) continue;
          const res = await fetch(href, { mode: 'cors' });
          const blob = await res.blob();
          const reader = new FileReader();
          const dataUrl: string = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          imgEl.setAttribute('href', dataUrl);
        } catch (e) {
          console.warn('[extractSelection] failed to inline', href, e);
        }
      }

      try { clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink'); } catch (e: any) {}
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(clone);
      if (!source.match(/^<\?xml/)) source = '<?xml version="1.0" standalone="no"?>\n' + source;

      const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = rectW;
        canvas.height = rectH;
        const ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); return; }
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const mime = asJpeg ? 'image/jpeg' : 'image/png';
        const dataUrl = canvas.toDataURL(mime);
        
        // Add extracted image to workspace instead of downloading
        saveForUndo();
        const newShape: DistortableShape = {
          id: `extracted-${Date.now()}`,
          img: dataUrl,
          dots: [
            { id: 'tl', x: 0, y: 0 },
            { id: 'tr', x: rectW, y: 0 },
            { id: 'br', x: rectW, y: rectH },
            { id: 'bl', x: 0, y: rectH }
          ],
          dims: { width: rectW, height: rectH },
          position: { x: rectX + 20, y: rectY + 20 },
          scale: 1,
          showDots: true,
          fillColor: undefined,
          erasedPaths: []
        };
        
        setWorkspaceShapes(prev => [...prev, newShape]);
        alert('Extracted image added to workspace!');
      };
      img.src = url;
    } catch (err) {
      console.error('extractSelection failed', err);
      alert('Extraction failed. Try uploading images (CORS) or check console.');
    }
    setSelectionRect(null);
    setContextMenu(null);
  }, [selectionRect]);

  const pasteFromSelection = useCallback(() => {
    if (!clipboard || (!clipboard.shapes.length && !clipboard.strokes.length)) return;
    saveForUndo();
    const PASTE_OFFSET = 30;
    // Get paste position from last selection or center
    let pasteX = 100;
    let pasteY = 100;
    if (selectionRect) {
      pasteX = Math.min(selectionRect.x1, selectionRect.x2);
      pasteY = Math.min(selectionRect.y1, selectionRect.y2);
    }
    // Paste shapes and strokes with new IDs and offset position
    const newShapes = clipboard.shapes.map(shape => ({
      ...shape,
      id: `s-${Date.now()}-${Math.random()}`,
      position: { x: (shape.position?.x ?? 0) + PASTE_OFFSET, y: (shape.position?.y ?? 0) + PASTE_OFFSET },
      groupId: undefined // Remove group when pasting
    }));
    const newStrokes = clipboard.strokes.map(stroke => ({
      ...stroke,
      id: `st-${Date.now()}-${Math.random()}`,
      points: stroke.points.map(p => ({ ...p, x: p.x + PASTE_OFFSET, y: p.y + PASTE_OFFSET })),
      groupId: undefined
    }));
    setWorkspaceShapes(prev => [...prev, ...newShapes]);
    setStrokes(prev => [...prev, ...newStrokes]);
    setSelectionRect(null);
    setContextMenu(null);
  }, [clipboard, saveForUndo, selectionRect]);

  const bringToFront = (id: string, type: "shape" | "stroke") => {
    saveForUndo();
    const maxZ = Math.max(
      ...workspaceShapes.map(s => s.zIndex || 0),
      ...strokes.map(s => s.zIndex || 0),
      0
    );
    
    if (type === "shape") {
      setWorkspaceShapes((prev) => {
        const item = prev.find((s) => s.id === id);
        if (!item) return prev;
        return [...prev.filter((s) => s.id !== id), { ...item, zIndex: maxZ + 1 }];
      });
    } else {
      setStrokes((prev) => {
        const item = prev.find((s) => s.id === id);
        if (!item) return prev;
        return [...prev.filter((s) => s.id !== id), { ...item, zIndex: maxZ + 1 }];
      });
    }
    setContextMenu(null);
  };

  const sendToBack = (id: string, type: "shape" | "stroke") => {
    saveForUndo();
    const minZ = Math.min(
      ...workspaceShapes.map(s => s.zIndex || 0),
      ...strokes.map(s => s.zIndex || 0),
      0
    );
    
    if (type === "shape") {
      setWorkspaceShapes((prev) => {
        const item = prev.find((s) => s.id === id);
        if (!item) return prev;
        return [{ ...item, zIndex: minZ - 1 }, ...prev.filter((s) => s.id !== id)];
      });
    } else {
      setStrokes((prev) => {
        const item = prev.find((s) => s.id === id);
        if (!item) return prev;
        return [{ ...item, zIndex: minZ - 1 }, ...prev.filter((s) => s.id !== id)];
      });
    }
    setContextMenu(null);
  };

  const toggleGroupStrokes = (shapeId: string) => {
    saveForUndo();
    const shape = workspaceShapes.find(s => s.id === shapeId);
    
    if (shape && shape.groupId) {
      const groupStrokes = strokes.filter(s => s.groupId === shape.groupId);
      const areAnyVisible = groupStrokes.some(s => s.visible !== false);
      const newVisibleState = !areAnyVisible;

      setStrokes(prev => prev.map(s => {
        if (s.groupId === shape.groupId) {
          return { ...s, visible: newVisibleState };
        }
        return s;
      }));
    }
    setContextMenu(null);
  };

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/templates");
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) { setTemplates(data); setSelectedImage(data[0]); }
      } catch (e) { setTemplates(["/template1.png"]); setSelectedImage("/template1.png"); }
    }
    load();
  }, []);

  const runTrace = useCallback(() => {
    if (!selectedImage) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImgDims({ width: img.width, height: img.height });
      ImageTracer.imageToSVG(selectedImage, (svgString: string) => {
        const inner = svgString.replace(/<svg[^>]*>/, "").replace(/<\/svg>/, "").replace(/<rect[^>]*\/>/g, "");
        setSvgContent(inner);
        setCandidates([]);
        setSourceDots([]);
      }, { numberofcolors: 2, ltres: 1, qtres: 1, scale: 1 });
    };
    img.src = selectedImage;
  }, [selectedImage]);

  useEffect(() => { if (selectedImage) runTrace(); }, [selectedImage, runTrace]);

  useEffect(() => {
    if (!svgContent) return;
    const ns = "http://www.w3.org/2000/svg";
    const tmp = document.createElementNS(ns, "svg");
    tmp.innerHTML = svgContent;
    const results: Candidate[] = [];
    Array.from(tmp.querySelectorAll("path")).forEach((p, pathIdx) => {
      const d = p.getAttribute("d") || "";
      const subs = d.match(/([Mm][^Mm]*)/g) || [];
      subs.forEach((sd, subIdx) => {
        results.push({ id: `path-${pathIdx}-${subIdx}`, d: sd, area: 0, selected: false });
      });
    });
    setCandidates(results);
  }, [svgContent]);

  const getCoords = (e: any) => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, rx: 0, ry: 0 };
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: cx - rect.left, y: cy - rect.top, rx: cx, ry: cy };
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        setSelectedImage(url);
      };
      reader.readAsDataURL(file);
    }
  };

  const getWorkspaceBgClasses = () => {
    const bgMap: Record<string, string> = {
      white: 'bg-white border-slate-300',
      amber: 'bg-gradient-to-br from-amber-100 to-orange-100 border-amber-200',
      slate: 'bg-gradient-to-br from-slate-200 to-slate-300 border-slate-400',
      gray: 'bg-gradient-to-br from-gray-100 to-gray-200 border-gray-300',
      blue: 'bg-gradient-to-br from-blue-100 to-cyan-100 border-blue-200'
    };
    return bgMap[workspaceBgColor] || bgMap['amber'];
  };


  const handleRemoveBackground = async () => {
    if (!selectedImage) return;
    
    try {
      setIsRemovingBg(true);
      console.log("Starting background removal...");
      
      // Get absolute URL for publicPath
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const publicPath = `${origin}/background-removal-data/`;
      console.log("Using publicPath:", publicPath);
      
      const config = {
        publicPath: publicPath,
        debug: false
      };
      
      // Preload assets first
      console.log("Preloading assets...");
      await preload(config);
      console.log("Assets preloaded successfully");
      
      // Convert data URL to blob for better handling
      let imageInput: Blob | string = selectedImage;
      if (selectedImage.startsWith('data:')) {
        console.log("Converting data URL to Blob...");
        const response = await fetch(selectedImage);
        imageInput = await response.blob();
        console.log("Blob created, size:", imageInput.size);
      }
      
      // Call removeBackground with proper config
      console.log("Calling removeBackground...");
      const imageBlob = await removeBackground(imageInput, config);
      console.log("Background removed successfully, blob size:", imageBlob.size);
      
      // Convert the resulting blob back to a data URL
      const reader = new FileReader();
      reader.readAsDataURL(imageBlob);
      reader.onloadend = () => {
        const base64data = reader.result as string;
        setSelectedImage(base64data);
        setIsRemovingBg(false);
        console.log("Background removal complete!");
      };
      reader.onerror = () => {
        console.error("FileReader error:", reader.error);
        throw new Error("Failed to read blob");
      };
    } catch (error) {
      console.error("Error removing background:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Failed to remove background: ${errorMessage}`);
      setIsRemovingBg(false);
    }
  };



  const sweepErase = (x: number, y: number) => {
    setStrokes(prev => prev.map(st => ({ ...st, points: st.points.filter(p => Math.hypot(p.x - x, p.y - y) > ERASE_RADIUS) })).filter(st => st.points.length > 0));
    setWorkspaceShapes(prev => prev.map(s => {
      const localX = (x - s.position.x) / s.scale;
      const localY = (y - s.position.y) / s.scale;
      if (localX > -50 && localX < s.dims.width + 50 && localY > -50 && localY < s.dims.height + 50) {
        const r = ERASE_RADIUS / Math.max(0.001, s.scale);
        const hole = `M ${localX - r} ${localY} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 -${r * 2} 0`;
        return { ...s, erasedPaths: [...(s.erasedPaths || []), hole], dots: s.dots.filter(d => Math.hypot(s.position.x + d.x * s.scale - x, s.position.y + d.y * s.scale - y) > ERASE_RADIUS) };
      }
      return s;
    }));
  };

  const generatePathData = (pts: { x: number; y: number }[], close = true) => {
    if (!pts || pts.length === 0) return "";
    const d = `M ${pts[0].x} ${pts[0].y}` + pts.slice(1).map(p => ` L ${p.x} ${p.y}`).join("");
    return close ? d + " Z" : d;
  };

  // Export current workspace as PNG/JPG by serializing the SVG, inlining images, and drawing to a canvas
  const downloadImage = async (type: 'png' | 'jpg' = 'png') => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const svgEl = workspaceRef.current;
    if (!svgEl) return;

    console.log('[downloadImage] start', type);

    // 1. Determine download bounds & visibility
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasContent = false;
    const svgRect = svgEl.getBoundingClientRect();
    
    // If a shape is selected, we only want to download THAT shape
    let targetElements: Element[] = [];
    
    if (selectedShapeId) {
        // Find the specific element
        const el = svgEl.querySelector(`[data-shape-id="${selectedShapeId}"]`) || svgEl.querySelector(`#${selectedShapeId}`); // Fallback
        if (el) {
            targetElements = [el];
            // Also include any associated strokes/defs if possible, but mainly the shape
        } else {
             // Fallback to all content if selection not found in DOM
             targetElements = Array.from(svgEl.querySelectorAll('g, path, image, circle, rect'));
        }
    } else {
        // No selection: Download all visible content (auto-crop)
        targetElements = Array.from(svgEl.querySelectorAll('g, path, image, circle, rect'));
    }

    targetElements.forEach((child) => {
         if (child instanceof SVGGraphicsElement) {
            // Filter out UI elements
            if (child.getAttribute('data-control-dot') || child.classList.contains('control-dot')) return;
            if (child.tagName === 'defs') return;
            
            // Check visibility
            const style = window.getComputedStyle(child);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

            // Skip background
            if (child.id === 'workspace-bg' || child.closest('#workspace-bg')) return;
            
             // Skip if we are in single-selection mode and this isn't the selected item
            if (selectedShapeId && child.getAttribute('data-shape-id') !== selectedShapeId && child.id !== selectedShapeId && !child.closest(`[data-shape-id="${selectedShapeId}"]`)) {
                 return;
            }

            const r = child.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            
            const x = r.left - svgRect.left;
            const y = r.top - svgRect.top;
            
            // Filter really large bounds (likely full workspace overlays) unless it IS the selected shape
            if (!selectedShapeId && r.width >= svgRect.width - 2 && r.height >= svgRect.height - 2) return;
            
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + r.width > maxX) maxX = x + r.width;
            if (y + r.height > maxY) maxY = y + r.height;
            hasContent = true;
         }
    });

    let viewBox = null;
    let viewWidth = svgRect.width;
    let viewHeight = svgRect.height;

    if (hasContent && minX !== Infinity) {
          const padding = 20;
          minX -= padding;
          minY -= padding;
          maxX += padding;
          maxY += padding;
          
          viewWidth = maxX - minX;
          viewHeight = maxY - minY;
          viewBox = `${minX} ${minY} ${viewWidth} ${viewHeight}`;
    }

    // Clone and inline external images to avoid CORS/blob issues
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    
    // If selecting a single shape, remove everything else from the clone to be safe
    if (selectedShapeId) {
        const kept = clone.querySelectorAll(`[data-shape-id="${selectedShapeId}"]`);
        // We can't easily remove "everything else" without breaking defs, patterns, etc.
        // Instead, let's just rely on the viewBox cropping.
        // But to be super clean, we could set opacity=0 on non-selected items? 
        // Let's stick to viewBox cropping first, it's safer for preserving context (shadows, etc).
        // Actually, if we want transparent background, we MUST ensure no background rects are present.
        
        // Remove background explicitly in clone
        const bg = clone.querySelector('#workspace-bg');
        if (bg) bg.remove();
        
        // Hide UI controls
        clone.querySelectorAll('[data-control-dot], .control-dot').forEach(d => d.remove());
    } else {
        clone.querySelectorAll('[data-control-dot], .control-dot').forEach(d => d.remove());
    }

    if (viewBox) {
        clone.setAttribute('viewBox', viewBox);
        clone.setAttribute('width', `${viewWidth}`);
        clone.setAttribute('height', `${viewHeight}`);
    }

    console.log('[downloadImage] cloned svg, bounds:', viewBox);

    const images = Array.from(clone.querySelectorAll('image')) as SVGImageElement[];
    let inlined = 0;
    for (const imgEl of images) {
      const href = imgEl.getAttribute('href') || imgEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
      if (!href) continue;
      try {
        // If the image is already a data URL, no need to fetch or convert
        if (href.startsWith('data:')) {
          console.log('[downloadImage] image already data URL; skipping fetch');
          inlined++;
          continue;
        }
        // Fetch remote/blob URLs and convert to data URL for inlining
        const res = await fetch(href, { mode: 'cors' });
        const blob = await res.blob();
        const reader = new FileReader();
        const dataUrl: string = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        imgEl.setAttribute('href', dataUrl);
        inlined++;
      } catch (e) {
        console.warn('[downloadImage] failed to inline', href, e);
      }
    }
    console.log('[downloadImage] inlined images', inlined);

    // Ensure SVG namespaces are present so hrefs/xlink are serialized correctly
    try { clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink'); } catch (e) {}
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(clone);
    if (!source.match(/^<\?xml/)) source = '<?xml version="1.0" standalone="no"?>\n' + source;

    const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      console.log('[downloadImage] image loaded for canvas draw');
      const canvas = document.createElement('canvas');
      
      // Use the VIEW DIMENSIONS from our calculation, not the full SVG or image natural size
      // This ensures we get the cropped version at high quality
      // We can scale it up for better quality download
      const contentScale = 1; // Increase to 2 or 3 for higher res
      canvas.width = viewWidth * contentScale;
      canvas.height = viewHeight * contentScale;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); console.error('[downloadImage] no canvas context'); return; }
      
      // DO NOT FILL WHITE BACKGROUND - keep it transparent
      // ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const mime = type === 'jpg' ? 'image/jpeg' : 'image/png';
      const dataUrl = canvas.toDataURL(mime);
      console.log('[downloadImage] created dataUrl', dataUrl.substring(0, 40));
      const link = document.createElement('a');
      link.download = `design-${Date.now()}.${type}`;
      link.href = dataUrl;
      link.click();
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      console.error('[downloadImage] image load error', e);

      alert('Failed to render SVG for export. Check console for details.');
    };
    img.src = url;
  };

  const [showSubmissionModal, setShowSubmissionModal] = useState(false);

  // Helper for generating shareable image
  const getDesignImage = useCallback(async (): Promise<string | null> => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    const svgEl = workspaceRef.current;
    if (!svgEl) return null;

    try {
      // 1. Calculate Content Bounding Box
      // We need to find the extent of actual content to crop the view
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasContent = false;
      const svgRect = svgEl.getBoundingClientRect();
      // Only select graphic elements we care about: paths, images, circles, rects (excluding UI helpers)
      const children = Array.from(svgEl.querySelectorAll('g, path, image, circle, rect'));

      children.forEach((child) => {
         if (child instanceof SVGGraphicsElement) {
            // Filter out UI elements like control dots if they aren't marked
            if (child.getAttribute('data-control-dot') || child.classList.contains('control-dot')) return;
            if (child.tagName === 'defs') return;
            
            // Check if element is visible
            const style = window.getComputedStyle(child);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

            // Check if it's a filler or background helper
            // If it's the main workspace background, skip it
            if (child.id === 'workspace-bg' || child.closest('#workspace-bg')) return;


            const r = child.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            
            // Relative to SVG
            // Careful: getBoundingClientRect includes transforms. 
            // We want the visual bounds relative to the SVG container.
            const x = r.left - svgRect.left;
            const y = r.top - svgRect.top;
            
            // Filter really large bounds (likely full workspace overlays)
            if (r.width >= svgRect.width - 2 && r.height >= svgRect.height - 2) return;
            
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + r.width > maxX) maxX = x + r.width;
            if (y + r.height > maxY) maxY = y + r.height;
            hasContent = true;
         }
      });
      
      // Default to full view if no content found
      if (!hasContent) {
         minX = 0; minY = 0; 
         maxX = svgRect.width; maxY = svgRect.height;
      }
      
      // Add padding (20px)
      const padding = 20;
      let viewBox = null;
      let viewWidth = 0;
      let viewHeight = 0;
      
      if (hasContent && minX !== Infinity) {
          minX -= padding;
          minY -= padding;
          maxX += padding;
          maxY += padding;
          
          viewWidth = maxX - minX;
          viewHeight = maxY - minY;
          
          viewBox = `${minX} ${minY} ${viewWidth} ${viewHeight}`;
          
          console.log('[getDesignImage] Calculated bounds:', viewBox, 'Dimensions:', viewWidth, viewHeight);
      } else {
        console.warn('[getDesignImage] No content bounds found, defaulting to full view');
      }

      // 2. Clone SVG and prepare for rasterization
      const clone = svgEl.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

      if (viewBox) {
        clone.setAttribute('viewBox', viewBox);
        // Explicitly set width/height attributes to match aspect ratio
        clone.setAttribute('width', `${viewWidth}`);
        clone.setAttribute('height', `${viewHeight}`);
      } else {
        // Fallback dimensions if no content detected
        clone.setAttribute('width', '800');
        clone.setAttribute('height', '800');
      }
      
      clone.querySelectorAll('[data-control-dot]').forEach(d => d.remove());
      // Also remove elements with class 'control-dot' which might not have the data attribute
      clone.querySelectorAll('.control-dot').forEach(d => d.remove());
      
      // 2. Inline images
      const images = Array.from(clone.querySelectorAll('image')) as SVGImageElement[];
      await Promise.all(images.map(async (imgEl) => {
        const href = imgEl.getAttribute('href') || imgEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        if (!href || href.startsWith('data:')) return;
        try {
          const res = await fetch(href, { mode: 'cors' });
          const blob = await res.blob();
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve) => {
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          imgEl.setAttribute('href', dataUrl);
        } catch (e) { console.warn('Inline err', e); }
      }));

      // 3. Serialize and render to canvas
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(clone);
      if (!source.match(/^<\?xml/)) source = '<?xml version="1.0" standalone="no"?>\n' + source;

      const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      return new Promise((resolve) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = 800; 
          // Calculate scale to "COVER" the canvas if we want to fill the box completely (zoom in)
          // or "CONTAIN" if we want to see the whole design.
          // User asked "stretch and fit into the whole display box", which usually means
          // "FILL" (ignore aspect ratio) or "COVER" (crop sides/top to fill)
          // Let's use CONTAIN but with minimal padding first, as distortion is usually bad for designs.
          // BUT - the user specifically said "stretch and fit".
          // If they want it to fill the box in the gallery, we might just want to save the 
          // image cropped TIGHTLY without any whitespace, and let CSS handle the "stretch/cover".
          
          // Re-drawing logic:
          // 1. We cropped the SVG ViewBox to the content exactly.
          // 2. We want the resulting output image to match the Aspect Ratio of the content.
          // 3. Instead of a fixed 800x800 canvas, let's size the canvas to the content's aspect ratio.
          
          let targetW = 800;
          let targetH = 800;
          
          // If we successfully calculated content bounds, use that aspect ratio
          if (viewWidth > 0 && viewHeight > 0) {
             const aspect = viewWidth / viewHeight;
             if (aspect > 1) {
                targetH = 800 / aspect;
             } else {
                targetW = 800 * aspect;
             }
          }
          
          canvas.width = targetW;
          canvas.height = targetH;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          
          // REMOVED: ctx.fillStyle = '#ffffff'; ctx.fillRect(...)
          // Keeping transparency so "just the images" are saved.
          
          // Draw image to fill the canvas exactly (since canvas matches aspect ratio)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          // Use PNG to preserve transparency
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      });
    } catch (err) {
      console.error('getDesignImage error', err);
      return null;
    }
  }, []);

  const hexToRgb = (hex: string) => {
    if (!hex) return null;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6) return null;
    const bigint = parseInt(h, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  };

  // Replace sampled color in a shape's image with a new color (within pickThreshold)
  const replaceColorInShape = useCallback(async (shapeId: string, pickX?: number, pickY?: number) => {
    const shape = workspaceShapes.find(s => s.id === shapeId);
    if (!shape) { alert('Shape not found'); return; }
    try {
      saveForUndo();
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = shape.img; });

      const canvas = document.createElement('canvas');
      const w = shape.dims.width;
      const h = shape.dims.height;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img, 0, 0, w, h);

      // Determine pick coordinates in image space
      let imgX = Math.round(( (pickX ?? (shape.position.x + (w*shape.scale)/2) ) - shape.position.x ) / shape.scale);
      let imgY = Math.round(( (pickY ?? (shape.position.y + (h*shape.scale)/2) ) - shape.position.y ) / shape.scale);
      imgX = Math.max(0, Math.min(w - 1, imgX));
      imgY = Math.max(0, Math.min(h - 1, imgY));

      const pickData = ctx.getImageData(imgX, imgY, 1, 1).data;
      const tr = pickData[0], tg = pickData[1], tb = pickData[2];

      // Ask user for replacement color (simple prompt for now)
      const targetHex = prompt('Enter replacement hex color (e.g. #FF00AA)');
      if (!targetHex) return;
      const rgb = hexToRgb(targetHex.trim());
      if (!rgb) { alert('Invalid color'); return; }

      const imageData = ctx.getImageData(0,0,w,h);
      const data = imageData.data;
      const maxDist = Math.sqrt(255*255*3);
      const thresh = (pickThreshold / 100) * maxDist;
      const threshSq = thresh * thresh;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const dr = r - tr, dg = g - tg, db = b - tb;
        const distSq = dr*dr + dg*dg + db*db;
        if (distSq <= threshSq) {
          data[i] = rgb.r; data[i+1] = rgb.g; data[i+2] = rgb.b;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const newUrl = canvas.toDataURL('image/png');
      setWorkspaceShapes(prev => prev.map(s => s.id === shape.id ? { ...s, img: newUrl } : s));
    } catch (err) {
      console.error('replaceColorInShape failed', err);
      alert('Could not replace color. This is often a CORS issue — upload the image locally and try again.');
    }
  }, [workspaceShapes, pickThreshold, saveForUndo]);

  const handleDownload = (type: 'png' | 'jpg' = 'png') => {
    // If the source/sidebar is open on small screens it can overlap the workspace
    // and cause the browser to save the source image instead. Close it first
    // so the workspace SVG is rendered when we serialize it.
    if (isSidebarOpen) {
      setIsSidebarOpen(false);
      // wait for the sidebar close animation/paint
      setTimeout(() => {
        downloadImage(type);
      }, 220);
      return;
    }
    downloadImage(type);
  };

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-gradient-to-br from-slate-50 via-white to-stone-50 text-slate-900 overflow-hidden select-none touch-none" onClick={() => setContextMenu(null)}>
      {aiDraping.active && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-md">
           <div className="bg-white p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm font-black uppercase text-purple-600 animate-pulse">{aiDraping.text}</p>
           </div>
        </div>
      )}
      {showMannequinModal && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowMannequinModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl p-6 sm:p-8 max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-base sm:text-lg font-black uppercase text-slate-900">Dress Form Measurements</h2>
                <p className="text-[10px] text-slate-500 mt-1">Adjust to customize the dress form shape</p>
              </div>
              <button onClick={() => setShowMannequinModal(false)} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
            </div>
            <div className="space-y-4">
              <div><label className="block text-[10px] font-black uppercase text-slate-600 mb-2">Bust / Chest<span className="ml-2 text-pink-500 font-bold">{measurements.bust} cm</span></label><input id="bust-slider" type="range" min="70" max="130" value={measurements.bust} onChange={(e) => setMeasurements(prev => ({ ...prev, bust: parseInt(e.target.value) }))} className="w-full h-2 bg-pink-100 rounded-lg appearance-none cursor-pointer accent-pink-500" /></div>
              <div><label className="block text-[10px] font-black uppercase text-slate-600 mb-2">Under-Bust<span className="ml-2 text-purple-500 font-bold">{measurements.underBust} cm</span></label><input type="range" min="60" max="110" value={measurements.underBust} onChange={(e) => setMeasurements(prev => ({ ...prev, underBust: parseInt(e.target.value) }))} className="w-full h-2 bg-purple-100 rounded-lg appearance-none cursor-pointer accent-purple-500" /></div>
              <div><label className="block text-[10px] font-black uppercase text-slate-600 mb-2">Waist<span className="ml-2 text-yellow-600 font-bold">{measurements.waist} cm</span></label><input type="range" min="55" max="110" value={measurements.waist} onChange={(e) => setMeasurements(prev => ({ ...prev, waist: parseInt(e.target.value) }))} className="w-full h-2 bg-yellow-100 rounded-lg appearance-none cursor-pointer accent-yellow-500" /></div>
              <div><label className="block text-[10px] font-black uppercase text-slate-600 mb-2">Hips<span className="ml-2 text-blue-500 font-bold">{measurements.hips} cm</span></label><input type="range" min="75" max="140" value={measurements.hips} onChange={(e) => setMeasurements(prev => ({ ...prev, hips: parseInt(e.target.value) }))} className="w-full h-2 bg-blue-100 rounded-lg appearance-none cursor-pointer accent-blue-500" /></div>
              <div><label className="block text-[10px] font-black uppercase text-slate-600 mb-2">Torso Length<span className="ml-2 text-green-500 font-bold">{measurements.torsoLength} cm</span></label><input type="range" min="35" max="55" value={measurements.torsoLength} onChange={(e) => setMeasurements(prev => ({ ...prev, torsoLength: parseInt(e.target.value) }))} className="w-full h-2 bg-green-100 rounded-lg appearance-none cursor-pointer accent-green-500" /></div>
              <div><label className="block text-[10px] font-black uppercase text-slate-600 mb-2">Shoulder Width<span className="ml-2 text-indigo-500 font-bold">{measurements.shoulderWidth} cm</span></label><input type="range" min="30" max="50" value={measurements.shoulderWidth} onChange={(e) => setMeasurements(prev => ({ ...prev, shoulderWidth: parseInt(e.target.value) }))} className="w-full h-2 bg-indigo-100 rounded-lg appearance-none cursor-pointer accent-indigo-500" /></div>
              <div><label className="block text-[10px] font-black uppercase text-slate-600 mb-2">Neck Circumference<span className="ml-2 text-teal-500 font-bold">{measurements.neckCircumference} cm</span></label><input type="range" min="28" max="45" value={measurements.neckCircumference} onChange={(e) => setMeasurements(prev => ({ ...prev, neckCircumference: parseInt(e.target.value) }))} className="w-full h-2 bg-teal-100 rounded-lg appearance-none cursor-pointer accent-teal-500" /></div>
            </div>
            <div className="mt-8 flex gap-3">
              <button onClick={() => setShowMannequinModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-colors">Cancel</button>
              <button id="add-mannequin-btn" onClick={() => createMannequinWithMeasurements(measurements)} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-xl text-[10px] font-black uppercase hover:shadow-lg transition-all">Add to Canvas</button>
            </div>
          </div>
        </div>
      )}
      {showShapesModal && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowShapesModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl p-6 sm:p-8 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-base sm:text-lg font-black uppercase text-slate-900">Add Shape</h2>
                <p className="text-[10px] text-slate-500 mt-1">Select a shape to add to your canvas</p>
              </div>
              <button onClick={() => setShowShapesModal(false)} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
            </div>
            <div className="grid grid-cols-3 gap-4 max-h-[60vh] overflow-y-auto pr-2">
              <button onClick={() => addShapeToCanvas('square')} className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl border-2 border-transparent hover:border-indigo-200 transition-all group">
                <div className="w-12 h-12 bg-slate-200 group-hover:bg-indigo-400 transition-colors mb-2"></div>
                <span className="text-[10px] font-black uppercase text-slate-600 group-hover:text-indigo-600">Square</span>
              </button>
              <button onClick={() => addShapeToCanvas('circle')} className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl border-2 border-transparent hover:border-indigo-200 transition-all group">
                <div className="w-12 h-12 bg-slate-200 group-hover:bg-indigo-400 transition-colors rounded-full mb-2"></div>
                <span className="text-[10px] font-black uppercase text-slate-600 group-hover:text-indigo-600">Circle</span>
              </button>
              <button onClick={() => addShapeToCanvas('oval')} className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl border-2 border-transparent hover:border-indigo-200 transition-all group">
                <div className="w-12 h-8 bg-slate-200 group-hover:bg-indigo-400 transition-colors rounded-[50%] mb-2 mt-2"></div>
                <span className="text-[10px] font-black uppercase text-slate-600 group-hover:text-indigo-600">Oval</span>
              </button>
              <button onClick={() => addShapeToCanvas('triangle')} className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl border-2 border-transparent hover:border-indigo-200 transition-all group">
                <div className="w-0 h-0 border-l-[24px] border-l-transparent border-r-[24px] border-r-transparent border-b-[41.6px] border-b-slate-200 group-hover:border-b-indigo-400 transition-colors mb-2"></div>
                <span className="text-[10px] font-black uppercase text-slate-600 group-hover:text-indigo-600">Triangle</span>
              </button>
              <button onClick={() => addShapeToCanvas('star')} className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl border-2 border-transparent hover:border-indigo-200 transition-all group">
                <svg className="w-12 h-12 text-slate-200 group-hover:text-indigo-400 transition-colors mb-2" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                <span className="text-[10px] font-black uppercase text-slate-600 group-hover:text-indigo-600">Star</span>
              </button>
              <button onClick={() => addShapeToCanvas('heart')} className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl border-2 border-transparent hover:border-indigo-200 transition-all group">
                <svg className="w-12 h-12 text-slate-200 group-hover:text-indigo-400 transition-colors mb-2" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                <span className="text-[10px] font-black uppercase text-slate-600 group-hover:text-indigo-600">Heart</span>
              </button>
              <button onClick={() => addShapeToCanvas('line')} className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl border-2 border-transparent hover:border-indigo-200 transition-all group">
                <svg className="w-12 h-12 text-slate-200 group-hover:text-indigo-400 transition-colors mb-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 20L20 4"/></svg>
                <span className="text-[10px] font-black uppercase text-slate-600 group-hover:text-indigo-600">Line</span>
              </button>
              <button onClick={() => addShapeToCanvas('curve')} className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl border-2 border-transparent hover:border-indigo-200 transition-all group">
                <svg className="w-12 h-12 text-slate-200 group-hover:text-indigo-400 transition-colors mb-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 20 Q 12 4 20 20"/></svg>
                <span className="text-[10px] font-black uppercase text-slate-600 group-hover:text-indigo-600">Curve</span>
              </button>
              {customAssets.map((asset) => (
                <button 
                  key={asset.name} 
                  onClick={() => addShapeToCanvas(`asset:${asset.name}`)} 
                  className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl border-2 border-transparent hover:border-indigo-200 transition-all group"
                >
                    <img 
                      src={asset.path} 
                      alt={asset.name}
                      className="w-10 h-10 object-contain mb-2 drop-shadow-md"
                    />
                    <span className="text-[10px] font-black uppercase text-slate-600 group-hover:text-indigo-600 truncate w-full text-center">
                      {asset.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ")}
                    </span>
                </button>
              ))}
            </div>
            <div className="mt-8">
              <button onClick={() => setShowShapesModal(false)} className="w-full bg-slate-100 text-slate-600 py-3 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}
      <header className="h-16 flex items-center justify-between px-2 lg:px-8 bg-gradient-to-r from-yellow-600 via-yellow-500 to-yellow-600 border-b-4 border-[#B87333] shrink-0 z-[100] shadow-md">
        <div className="flex items-center gap-2 sm:gap-4">
          <button id="trace-btn" onClick={() => setIsSidebarOpen(true)} className="lg:hidden bg-gradient-to-r from-yellow-500 to-yellow-600 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase shadow-md hover:shadow-lg transition-all">Trace</button>
          <div onClick={onBack} className="flex flex-col cursor-pointer active:scale-95 px-2">
            <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] text-white drop-shadow-sm">DesignIt <span className="text-[#e0f2fe] drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]">♦</span></span>
            <span className="hidden xs:block text-[7px] font-medium uppercase text-yellow-100">Studio</span>
          </div>
          <div className="hidden md:flex items-center gap-4">
            <Link href="/" className="text-white hover:text-yellow-100 font-medium text-[9px] uppercase transition-colors drop-shadow-sm">
              Home
            </Link>
            <Link href="/about" className="text-white hover:text-yellow-100 font-medium text-[9px] uppercase transition-colors drop-shadow-sm">
              About
            </Link>
            <Link href="/contact" className="text-white hover:text-yellow-100 font-medium text-[9px] uppercase transition-colors drop-shadow-sm">
              Contact
            </Link>
          </div>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 hidden lg:flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-slate-100 to-slate-200 rounded-full border-2 border-[#B87333] shadow-lg animate-pulse">
          <span className="text-[10px] font-black text-slate-800">Click</span>
          <span className="w-5 h-5 bg-gradient-to-br from-rose-500 to-rose-600 text-white rounded-full flex items-center justify-center text-[10px] font-black ring-1 ring-white">?</span>
          <span className="text-[10px] font-black text-slate-800">for interactive tutorial</span>
        </div>
          <div className="flex items-center gap-1 sm:gap-2">
          <button id="dress-form-btn" onClick={() => setShowMannequinModal(true)} className="px-2 sm:px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full text-[8px] sm:text-[9px] font-black uppercase shadow-md hover:shadow-lg transition-all flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C10.9 2 10 2.9 10 4s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 18h-3v-6h-2v6H9v-6H7v6H4v-8c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v8z"/></svg>
            <span className="hidden sm:inline">Dress Form</span>
          </button>
          <button id="undo-btn" onClick={undo} className="px-2 sm:px-4 py-2 bg-pink-50 text-pink-600 rounded-full text-[8px] sm:text-[9px] font-black uppercase border border-pink-100 hover:bg-pink-100">Undo</button>
          <button id="reset-btn" onClick={() => { if(confirm("Reset?")) { saveForUndo(); setWorkspaceShapes([]); setStrokes([]); } }} className="px-2 sm:px-4 py-2 bg-emerald-50 text-emerald-600 rounded-full text-[8px] sm:text-[9px] font-black uppercase border border-emerald-100 hover:bg-emerald-100">Reset</button>
          <button id="download-btn" onClick={() => handleDownload('png')} className="px-2 sm:px-4 py-2 bg-blue-50 text-blue-600 rounded-full text-[8px] sm:text-[9px] font-black uppercase border border-blue-100 hover:bg-blue-100">Download</button>
          <button id="dots-btn" onClick={() => setGlobalShowDots(!globalShowDots)} className={`px-2 sm:px-4 py-2 rounded-full text-[8px] sm:text-[9px] font-black uppercase border transition-all ${globalShowDots ? 'bg-yellow-50 text-yellow-700' : 'bg-white text-slate-400'}`}>Dots</button>
          <button id="lock-btn" onClick={() => setIsLocked(!isLocked)} className={`px-2 sm:px-4 py-2 rounded-full text-[8px] sm:text-[9px] font-black uppercase border transition-all ${isLocked ? 'bg-sky-500 text-white' : 'bg-white text-sky-500'}`}>Lock</button>
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden relative">
        <aside className={`fixed lg:static inset-0 lg:w-[320px] bg-slate-50 lg:border-r-2 border-slate-200 flex flex-col z-[200] lg:z-0 transition-transform shadow-lg ${isSidebarOpen ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}`}>
          <div className="p-6 shrink-0 bg-white border-b-2 border-slate-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xs font-black uppercase text-slate-800">Source <span className="text-yellow-500">✨</span></h3>
              <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-500 hover:text-slate-800 text-xs font-bold transition-colors">CLOSE ✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button 
                onClick={() => {
                  saveForUndo();
                  const pts: {id: string, x: number, y: number}[] = [];
                  const fs = imgDims.width ? 300 / imgDims.width : 1; 
                  setWorkspaceShapes(prev => [...prev, { id: `s-${Date.now()}`, img: selectedImage!, dots: [
                    { id: `p1`, x: 0, y: 0 },
                    { id: `p2`, x: imgDims.width, y: 0 },
                    { id: `p3`, x: imgDims.width, y: imgDims.height },
                    { id: `p4`, x: 0, y: imgDims.height }
                  ], dims: { ...imgDims }, position: { x: 100, y: 100 }, scale: fs, showDots: true, erasedPaths: [], clipUpdate: Date.now(), opacity: 1 }]); 
                  setSourceDots([]); 
                  setIsSidebarOpen(false);
                }}
                className="col-span-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-2 rounded-md text-[9px] font-bold uppercase shadow-sm hover:shadow-md transition-all"
              >
                Add Original Image As-Is
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="bg-gradient-to-br from-slate-500 to-slate-600 text-white py-1.5 px-2 rounded-md text-[8px] font-bold uppercase shadow-sm hover:shadow-md transition-all">Upload<input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" /></button>
              <button id="add-btn" onClick={() => { 
                // Sample the dots first
                const ns = "http://www.w3.org/2000/svg"; 
                let pts: Dot[] = []; 
                candidates.filter(c => c.selected).forEach(c => { 
                  const path = document.createElementNS(ns, "path"); 
                  path.setAttribute("d", c.d); 
                  document.body.appendChild(path); 
                  const len = path.getTotalLength(); 
                  for (let i = 0; i <= len; i += Math.max(3, Math.round(len / 40))) { 
                    const p = path.getPointAtLength(i); 
                    pts.push({ id: `p-${Math.random()}`, x: p.x, y: p.y }); 
                  } 
                  document.body.removeChild(path); 
                }); 
                // Then add to workspace
                if (pts.length > 0) {
                  saveForUndo(); 
                  const fs = imgDims.width ? 150 / imgDims.width : 1; 
                  setWorkspaceShapes(prev => [...prev, { id: `s-${Date.now()}`, img: selectedImage!, dots: [...pts], dims: { ...imgDims }, position: { x: 100, y: 100 }, scale: fs, showDots: true, erasedPaths: [], opacity: 1 }]); 
                  setSourceDots([]); 
                  setIsSidebarOpen(false);
                }
              }} disabled={candidates.filter(c => c.selected).length === 0} className="bg-gradient-to-br from-slate-800 to-slate-900 text-yellow-300 py-1.5 px-2 rounded-md text-[8px] font-bold uppercase shadow-sm hover:shadow-md transition-all disabled:opacity-30">Add to Canvas</button>
            </div>
            {selectedImage && (
              <div className="mb-3">
                <button 
                  onClick={handleRemoveBackground} 
                  disabled={isRemovingBg}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-2 rounded-md text-[8px] font-black uppercase shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isRemovingBg ? (
                    <>
                      <span className="animate-spin">⏳</span> AI Cleaning...
                    </>
                  ) : (
                    <>✨ AI Remove BG</>
                  )}
                </button>
              </div>
            )}

          </div>
          <div className="flex-1 p-4 overflow-hidden flex flex-col gap-4">
            <div className="flex-1 bg-slate-100 rounded-3xl overflow-hidden flex items-center justify-center relative border-2 border-slate-200 shadow-inner">
              <svg 
                id="trace-svg-container" 
                viewBox={`0 0 ${imgDims.width} ${imgDims.height}`} 
                className="w-full h-full p-4"
              >
                {selectedImage && <image href={selectedImage} width={imgDims.width} height={imgDims.height} />}
                {candidates.map((c, idx) => (<path key={c.id} id={idx === 0 ? "path-0-0" : c.id} d={c.d} fill={c.selected ? "rgba(251, 146, 60, 0.5)" : "transparent"} stroke={c.selected ? "#f97316" : "#cbd5e1"} strokeWidth={4} className="cursor-pointer" onClick={() => setCandidates(prev => prev.map(x => x.id === c.id ? {...x, selected: !x.selected} : x))} />))}
                {sourceDots.map((dot) => (<circle key={dot.id} cx={dot.x} cy={dot.y} r={8} fill="#f97316" stroke="#ffffff" strokeWidth={3} opacity={0.9} />))}
              </svg>
            </div>
            
            {/* Templates moved under source */}
            <div className="shrink-0">
              <h4 className="text-[10px] font-black uppercase text-slate-500 mb-2">Templates</h4>
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {templates.map((u, i) => (
                  <img
                    key={i}
                    id={`template-${i}`}
                    src={u}
                    onClick={() => setSelectedImage(u)}
                    className={`h-12 w-12 shrink-0 rounded-xl object-contain cursor-pointer border-2 transition-all ${selectedImage === u ? 'border-yellow-500 scale-105 bg-white' : 'border-transparent opacity-70 hover:opacity-100 bg-white/50'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </aside>
        <main className="flex-1 bg-[#F9F9FB] relative overflow-visible">
          {/* Top toolbar removed - Download moved into header controls */}
          {ghostCursor.active && (
            <div className="fixed pointer-events-none z-[1000] transition-all duration-700 ease-in-out flex flex-col items-center" style={{ left: ghostCursor.x, top: ghostCursor.y, transform: 'translate(-50%, -50%)' }}>
              <div className={`w-8 h-8 rounded-full border-4 border-yellow-400 bg-yellow-400/30 transition-transform ${ghostCursor.clicking ? 'scale-75' : 'scale-100'}`} />
              {tutorialStep !== null && <div className="mt-2 bg-slate-900 text-white text-[10px] font-bold px-3 py-1 rounded-lg shadow-xl">{tutorialSteps[tutorialStep].text}</div>}
            </div>
          )}
          {contextMenu && (
            <div className="fixed z-[300] bg-white border border-slate-200 shadow-2xl rounded-2xl overflow-hidden py-1 min-w-[140px]" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
              {contextMenu.type === "selection" ? (
                <>
                  <button onClick={createGroupFromSelection} className="w-full text-left px-4 py-2 hover:bg-amber-50 text-[9px] font-black uppercase border-b border-slate-100 text-amber-600">
                    🔗 Group Items
                  </button>
                  <button onClick={ungroupItemsFromSelection} className="w-full text-left px-4 py-2 hover:bg-orange-50 text-[9px] font-black uppercase border-b border-slate-100 text-orange-600">
                    🔓 Ungroup Items
                  </button>
                  <button onClick={copyFromSelection} className="w-full text-left px-4 py-2 hover:bg-blue-50 text-[9px] font-black uppercase border-b border-slate-100 text-blue-600">
                    📋 Copy Area
                  </button>
                  <button onClick={() => extractSelection(false)} className="w-full text-left px-4 py-2 hover:bg-green-50 text-[9px] font-black uppercase border-b border-slate-100 text-green-600">
                    ✂️ Extract Image
                  </button>
                  {clipboard && (clipboard.shapes.length > 0 || clipboard.strokes.length > 0) && (
                    <button onClick={pasteFromSelection} className="w-full text-left px-4 py-2 hover:bg-green-50 text-[9px] font-black uppercase text-green-600">
                      📌 Paste
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      if (contextMenu.type === "shape" || contextMenu.type === "stroke") bringToFront(contextMenu.id, contextMenu.type);
                    }}
                    className="w-full text-left px-4 py-2 text-[9px] font-black uppercase border-b border-slate-100 hover:bg-slate-50"
                  >
                    Bring to Front
                  </button>
                  <button
                    onClick={() => {
                      if (contextMenu.type === "shape" || contextMenu.type === "stroke") sendToBack(contextMenu.id, contextMenu.type);
                    }}
                    className="w-full text-left px-4 py-2 text-[9px] font-black uppercase border-b border-slate-100 hover:bg-slate-50"
                  >
                    Send to Back
                  </button>
                  {contextMenu.type === "shape" && !workspaceShapes.find(s => s.id === contextMenu.id)?.isMannequin && (
                    <button id="drape-menu-btn" onClick={() => openDrapeModal(contextMenu.id)} className="w-full text-left px-4 py-2 hover:bg-purple-50 text-[9px] font-black uppercase border-b border-slate-100 text-purple-600">
                      🎀 Drape to Mannequin
                    </button>
                  )}
                  {contextMenu.type === "shape" && (
                    <button id="pick-replace-btn" onClick={() => { replaceColorInShape(contextMenu.id, contextMenu.clickX, contextMenu.clickY); setContextMenu(null); }} className="w-full text-left px-4 py-2 hover:bg-yellow-50 text-[9px] font-black uppercase border-b border-slate-100 text-yellow-600">
                      🎨 Pick & Replace Color
                    </button>
                  )}
                  {contextMenu.type === "shape" && workspaceShapes.find(s => s.id === contextMenu.id)?.groupId && (
                    <button onClick={() => toggleGroupStrokes(contextMenu.id)} className="w-full text-left px-4 py-2 hover:bg-slate-50 text-[9px] font-black uppercase border-b border-slate-100 text-slate-600">
                      👁️ Toggle Strokes
                    </button>
                  )}
                  <button onClick={() => { saveForUndo(); if (contextMenu.type === "shape") setWorkspaceShapes(prev => prev.filter(s => s.id !== contextMenu.id)); else if (contextMenu.type === "stroke") setStrokes(prev => prev.filter(s => s.id !== contextMenu.id)); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-red-500 hover:bg-red-50 text-[9px] font-black uppercase">Delete Item</button>
                </>
              )}
            </div>
          )}
          <div className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col gap-2 p-2 bg-white/80 rounded-[2rem] shadow-xl z-50">
            {(["cursor", "scissor", "pen", "ghost", "shapes", "fill", "erase"] as const).map((t) => (<button key={t} id={t === "shapes" ? "shapes-btn" : `${t}-tool`} onClick={() => t === "shapes" ? setShowShapesModal(true) : setActiveTool(t as any)} className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${activeTool === t ? 'bg-yellow-400 text-black' : 'text-slate-400 hover:bg-slate-100'}`}><span className="text-[10px] font-black uppercase">{t === "ghost" ? "👻" : t === "scissor" ? "✂️" : t.charAt(0)}</span></button>))}
            <div className="relative mt-2">
              <button id="color-swatch" onClick={() => setShowColorPanel(v => !v)} title="Choose color and transparency" style={{ backgroundColor: activeColor }} className="w-8 h-8 rounded-lg border border-slate-200 shadow-sm" />
              {showColorPanel && (
                <div className="fixed left-14 top-1/2 -translate-y-1/2 p-3 bg-white rounded shadow-xl z-50 w-[calc(100vw-4.5rem)] max-w-[16rem] sm:w-56 max-h-[75vh] sm:max-h-[85vh] overflow-y-auto">
                  <div className="flex flex-col gap-3">
                    {/* Top: Color Selection & Picking */}
                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-600 mb-1 block">Color Picker</label>
                      <input id="color-picker" type="color" value={activeColor} onChange={e => setActiveColor(e.target.value)} className="w-full h-10 p-0 cursor-pointer" />
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">Metallic</label>
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => setActiveColor("#FFC125")} className="w-6 h-6 rounded-full border border-yellow-300 ring-1 ring-yellow-500/50 shadow-sm hover:scale-125 transition-all duration-300" style={{background: "conic-gradient(from 45deg, #FFDF00, #FFC125, #DAA520, #FFD700, #FFDF00)"}} title="22K Gold" />
                        <button onClick={() => setActiveColor("#E5E4E2")} className="w-6 h-6 rounded-full border border-slate-200 ring-1 ring-slate-400/50 shadow-sm hover:scale-125 transition-all duration-300" style={{background: "conic-gradient(from 225deg, #E5E4E2, #FFFFFF, #E5E4E2, #C0C0C0, #E5E4E2)"}} title="Platinum" />
                        <button onClick={() => setActiveColor("#C0C0C0")} className="w-6 h-6 rounded-full border border-slate-300 shadow-sm hover:scale-125 transition-all duration-300" style={{background: "linear-gradient(135deg, #E0E0E0, #C0C0C0)"}} title="Silver" />
                        <button onClick={() => setActiveColor("#B87333")} className="w-6 h-6 rounded-full border border-orange-200 ring-1 ring-orange-400/50 shadow-sm hover:scale-125 transition-all duration-300" style={{background: "conic-gradient(from 90deg, #D2691E, #B87333, #CD7F32, #B87333)"}} title="Copper" />
                        <button onClick={() => setActiveColor("#B76E79")} className="w-6 h-6 rounded-full border border-rose-200 ring-1 ring-rose-400/50 shadow-sm hover:scale-125 transition-all duration-300" style={{background: "conic-gradient(from 135deg, #FFC0CB, #B76E79, #E6C4C8, #B76E79)"}} title="Rose Gold" />
                      </div>
                    </div>

                    {/* Gem Colors removed as requested */}

                    <div className="relative">
                      <label className="text-[10px] font-black uppercase text-slate-700">Cloth Type</label>
                      <div 
                        className="w-full mt-1 p-2 border rounded text-sm cursor-pointer flex items-center justify-between bg-white"
                        onClick={() => {
                          if (!showFabricDropdown) {
                            setIsFabricLoading(true);
                            setTimeout(() => {
                              setShowFabricDropdown(true);
                              setIsFabricLoading(false);
                            }, 50);
                          } else {
                            setShowFabricDropdown(false);
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {selectedClothType !== 'solid' && getFabricImagePath(selectedClothType) ? (
                            <img src={getFabricImagePath(selectedClothType)!} alt={selectedClothType} className="w-6 h-6 rounded object-cover" />
                          ) : selectedClothType !== 'solid' ? (
                            <div className="w-6 h-6 rounded" style={{ backgroundImage: `url(${generateTextureDataUrl(activeColor, normalizeFabric(selectedClothType), 64)})` }} />
                          ) : (
                            <div className="w-6 h-6 rounded" style={{ backgroundColor: activeColor }} />
                          )}
                          <span>{fabricOptions.find(o => o.value === selectedClothType)?.label || 'Solid'}</span>
                        </div>
                        {isFabricLoading ? (
                          <span className="text-xs animate-spin">⏳</span>
                        ) : (
                          <span className="text-xs">▼</span>
                        )}
                      </div>
                      
                      {showFabricDropdown && (
                        <div className="relative z-50 w-full mt-1 bg-white border rounded shadow-inner max-h-48 overflow-y-auto">
                          {fabricOptions.map(option => (
                            <div 
                              key={option.value}
                              className={`p-2 flex items-center gap-2 cursor-pointer hover:bg-slate-100 ${selectedClothType === option.value ? 'bg-slate-50' : ''}`}
                              onClick={() => {
                                setSelectedClothType(option.value);
                                setShowFabricDropdown(false);
                              }}
                            >
                              {option.value !== 'solid' && getFabricImagePath(option.value) ? (
                                <img src={getFabricImagePath(option.value)!} alt={option.label} className="w-6 h-6 rounded object-cover" />
                              ) : option.value !== 'solid' ? (
                                <div className="w-6 h-6 rounded" style={{ backgroundImage: `url(${generateTextureDataUrl(activeColor, normalizeFabric(option.value), 64)})` }} />
                              ) : (
                                <div className="w-6 h-6 rounded" style={{ backgroundColor: activeColor }} />
                              )}
                              <span className="text-sm">{option.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-1">Choose a fabric look to preview when filling shapes.</div>
                    </div>

                    <hr className="border-slate-100" />
                    
                    {/* Bottom: Settings & Tools */}
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-black uppercase text-slate-600">Pen Size</label>
                      <input id="pen-size" type="range" min={1} max={50} value={activePenSize} onChange={e => setActivePenSize(parseInt(e.target.value, 10))} className="flex-1" />
                      <span className="text-[10px] font-bold">{activePenSize}px</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-black uppercase text-slate-600">Fill Opacity</label>
                      <input id="fill-opacity" type="range" min={0} max={100} value={Math.round(activeFillOpacity * 100)} onChange={e => setActiveFillOpacity(parseInt(e.target.value, 10) / 100)} className="flex-1" />
                      <span className="text-[10px] font-bold">{Math.round(activeFillOpacity * 100)}%</span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase text-slate-700">Keep original color</span>
                        <span className="text-[10px] text-slate-400 leading-tight">Preserve underlying image colors</span>
                      </div>
                      <label className={`relative inline-flex items-center cursor-pointer select-none`}>
                        <input id="keep-original-color" type="checkbox" checked={keepOriginalColor} onChange={e => setKeepOriginalColor(e.target.checked)} className="sr-only" />
                        <div className={`${keepOriginalColor ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-slate-200'} w-12 h-6 rounded-full p-1 transition-colors`}>
                          <div className={`${keepOriginalColor ? 'translate-x-6' : 'translate-x-0'} w-4 h-4 bg-white rounded-full shadow transform transition-transform`} />
                        </div>
                      </label>
                    </div>

                    <div>
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black uppercase text-slate-700">Magic Erase Color</label>
                        <span className="text-[10px] font-bold bg-slate-100 px-1.5 py-0.5 rounded">{pickThreshold}%</span>
                      </div>
                      <input id="pick-threshold" type="range" min={0} max={100} value={pickThreshold} onChange={e => setPickThreshold(parseInt(e.target.value, 10))} className="w-full mt-1.5" />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button onClick={() => { setPickColorMode(true); setShowColorPanel(false); }} className="px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl text-[10px] font-black uppercase shadow-md hover:shadow-lg">Pick & Remove</button>
                        <button onClick={() => { setPickColorMode(false); }} className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase">Cancel</button>
                      </div>
                      {pickColorMode && <div className="text-[11px] mt-2 text-slate-500 leading-tight">Click image on canvas to erase matching color.</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Workspace background color selector */}

          <div className="shrink-0 p-4 pb-2 flex gap-2 items-center bg-white border-b border-slate-200 shadow-sm z-10 sticky top-0 flex-wrap">
            <span className="text-[9px] font-black uppercase text-slate-600">Canvas BG:</span>
            <button onClick={() => setWorkspaceBgColor('white')} className={`px-2 py-1 rounded text-[8px] font-bold transition-all ${workspaceBgColor === 'white' ? 'ring-2 ring-blue-500 bg-white text-slate-900' : 'bg-white border border-slate-300 text-slate-600 hover:border-slate-400'}`}>White</button>
            <button onClick={() => setWorkspaceBgColor('amber')} className={`px-2 py-1 rounded text-[8px] font-bold transition-all ${workspaceBgColor === 'amber' ? 'ring-2 ring-blue-500 bg-amber-200 text-slate-900' : 'bg-amber-100 border border-amber-300 text-slate-600 hover:border-amber-400'}`}>Amber</button>
            <button onClick={() => setWorkspaceBgColor('slate')} className={`px-2 py-1 rounded text-[8px] font-bold transition-all ${workspaceBgColor === 'slate' ? 'ring-2 ring-blue-500 bg-slate-300 text-white' : 'bg-slate-200 border border-slate-400 text-slate-600 hover:border-slate-500'}`}>Slate</button>
            <button onClick={() => setWorkspaceBgColor('gray')} className={`px-2 py-1 rounded text-[8px] font-bold transition-all ${workspaceBgColor === 'gray' ? 'ring-2 ring-blue-500 bg-gray-200 text-slate-900' : 'bg-gray-100 border border-gray-300 text-slate-600 hover:border-gray-400'}`}>Gray</button>
            <button onClick={() => setWorkspaceBgColor('blue')} className={`px-2 py-1 rounded text-[8px] font-bold transition-all ${workspaceBgColor === 'blue' ? 'ring-2 ring-blue-500 bg-blue-200 text-slate-900' : 'bg-blue-100 border border-blue-300 text-slate-600 hover:border-blue-400'}`}>Blue</button>

            <div className="h-4 w-px bg-slate-200 mx-1"></div>

            <button
               onClick={() => setShowSubmissionModal(true)}
               className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-md text-[9px] font-bold uppercase shadow hover:shadow-md transition-all ml-auto"
            >
              <Users size={10} />
              Submit to Community
            </button>
          </div>
          <div ref={canvasRef} className="w-full h-[calc(100vh-140px)] pb-[100px] md:pb-[120px] p-2 lg:p-8 overflow-auto" onPointerDown={(e) => {  
            // REST OF EXISTING LOGIC
            isPointerDownRef.current = true; 
            const c = getCoords(e); 
            
            // Start selection rectangle
            if (activeTool === "cursor" && !isLocked && e.target === workspaceRef.current) {
              setSelectionRect({ x1: c.x, y1: c.y, x2: c.x, y2: c.y });
            }
            
            if (activeTool === "scissor") {
              let shapeId = (e.target as SVGElement).getAttribute('data-shape-id');
              if (!shapeId) {
                for (let i = workspaceShapesRef.current.length - 1; i >= 0; i--) {
                   const s = workspaceShapesRef.current[i];
                   if (s.isMannequin) continue;
                   const sW = s.dims.width * s.scale;
                   const sH = s.dims.height * s.scale;
                   const cx = s.position.x + sW/2;
                   const cy = s.position.y + sH/2;
                   let dx = c.x - cx;
                   let dy = c.y - cy;
                   const angle = -(s.rotation || 0) * (Math.PI / 180);
                   let x1 = dx * Math.cos(angle) - dy * Math.sin(angle);
                   let y1 = dx * Math.sin(angle) + dy * Math.cos(angle);
                   if (x1 >= -sW/2 && x1 <= sW/2 && y1 >= -sH/2 && y1 <= sH/2) {
                      shapeId = s.id; break;
                   }
                }
              }
              const finalShapeId = shapeId || selectedShapeId || [...workspaceShapesRef.current].reverse().find(s => !s.isMannequin)?.id;
              if (finalShapeId) {
                setSelectedShapeId(finalShapeId);
                scissorTargetRef.current = finalShapeId;
              } else {
                scissorTargetRef.current = null;
              }
              setScissorDots([{ x: c.x, y: c.y }]);
              e.currentTarget.setPointerCapture(e.pointerId);
              return;
            }

            if (activeTool === "erase") { saveForUndo(); sweepErase(c.x, c.y); } 
            if (activeTool === "pen" || activeTool === "ghost") { saveForUndo(); const sid = `st-${Date.now()}`; 
              const maxZ = Math.max(
                ...workspaceShapes.map(s => s.zIndex || 0),
                ...strokes.map(s => s.zIndex || 0),
                0
              );
              setStrokes(prev => [...prev, { id: sid, points: [{ id: `pt-${Date.now()}`, x: c.x, y: c.y }], color: activeColor, width: activePenSize, zIndex: maxZ + 1, visible: activeTool === "pen" }]);
              penRef.current = { pointerId: e.pointerId, lastX: c.x, lastY: c.y, strokeId: sid };
              e.currentTarget.setPointerCapture(e.pointerId);
              return;
            } 
          }} onPointerMove={(e) => { const c = getCoords(e); 
            
            // Update selection rectangle
            if (selectionRect && isPointerDownRef.current) {
              setSelectionRect(prev => prev ? { ...prev, x2: c.x, y2: c.y } : null);
            }
            
            if (activeTool === "scissor" && isPointerDownRef.current) {
              setScissorDots(prev => {
                if (prev.length === 0) return [{x: c.x, y: c.y}];
                const last = prev[prev.length - 1];
                if (Math.hypot(last.x - c.x, last.y - c.y) > 10) {
                   return [...prev, {x: c.x, y: c.y}];
                }
                return prev;
              });
            }

            if (activeTool === "erase" && isPointerDownRef.current) sweepErase(c.x, c.y); if ((activeTool === "pen" || activeTool === "ghost") && penRef.current && e.pointerId === penRef.current.pointerId) { if (Math.hypot(c.x - penRef.current!.lastX, c.y - penRef.current!.lastY) >= PEN_SPACING) { setStrokes(prev => prev.map(s => s.id === penRef.current!.strokeId ? { ...s, points: [...s.points, { id: `pt-${Date.now()}`, x: c.x, y: c.y }] } : s));
                penRef.current!.lastX = c.x;
                penRef.current!.lastY = c.y;
              } } else if (draggingStrokeDot) { setStrokes(prev => prev.map(s => s.id === draggingStrokeDot.strokeId ? { ...s, points: s.points.map(p => p.id === draggingStrokeDot.dotId ? { ...p, x: c.x, y: c.y } : p) } : s));
              } else if (draggingDot) { setWorkspaceShapes(prev => prev.map(s => s.id !== draggingDot.shapeId ? s : { ...s, dots: s.dots.map(d => d.id === draggingDot.dotId ? { ...d, x: (c.x - s.position.x)/s.scale, y: (c.y - s.position.y)/s.scale } : d) }));
              } else if (draggingShapeId && !isLocked) { 
                const shape = workspaceShapes.find(s => s.id === draggingShapeId);
                if (shape?.groupId) {
                  // Move all items in the group
                  const deltaX = c.x - dragOffset.x - shape.position.x;
                  const deltaY = c.y - dragOffset.y - shape.position.y;
                  setWorkspaceShapes(prev => prev.map(s => s.groupId === shape.groupId ? { ...s, position: { x: s.position.x + deltaX, y: s.position.y + deltaY } } : s));
                  setStrokes(prev => prev.map(st => st.groupId === shape.groupId ? { ...st, points: st.points.map(p => ({ ...p, x: p.x + deltaX, y: p.y + deltaY })) } : st));
                } else {
                  setWorkspaceShapes(prev => prev.map(s => s.id === draggingShapeId ? { ...s, position: { x: c.x - dragOffset.x, y: c.y - dragOffset.y } } : s));
                }
              } else if (draggingStrokeId && !isLocked) {
                const stroke = strokes.find(st => st.id === draggingStrokeId);
                if (stroke?.groupId) {
                  // Move all items in the group
                  const deltaX = c.x - dragOffset.x;
                  const deltaY = c.y - dragOffset.y;
                  setWorkspaceShapes(prev => prev.map(s => s.groupId === stroke.groupId ? { ...s, position: { x: s.position.x + deltaX, y: s.position.y + deltaY } } : s));
                  setStrokes(prev => prev.map(st => st.groupId === stroke.groupId ? { ...st, points: st.points.map(p => ({ ...p, x: p.x + deltaX, y: p.y + deltaY })) } : st));
                } else {
                  const deltaX = c.x - dragOffset.x;
                  const deltaY = c.y - dragOffset.y;
                  setStrokes(prev => prev.map(st => st.id === draggingStrokeId ? { ...st, points: st.points.map(p => ({ ...p, x: p.x + deltaX, y: p.y + deltaY })) } : st));
                }
                setDragOffset({ x: c.x, y: c.y });
              } else if (resizingId) { 
                const shape = workspaceShapes.find(s => s.id === resizingId);
                const stroke = strokes.find(st => st.id === resizingId);
                
                if (shape) {
                  if (shape.groupId) {
                    // Get all items in the group and calculate group center
                    const groupShapes = workspaceShapes.filter(s => s.groupId === shape.groupId);
                    const groupStrokes = strokes.filter(st => st.groupId === shape.groupId);
                    
                    // Calculate scale factor (ratio, not delta)
                    const currentDist = Math.hypot(c.x - shape.position.x, c.y - shape.position.y);
                    const prevDist = Math.hypot(dragOffset.x - shape.position.x, dragOffset.y - shape.position.y);
                    const scaleFactor = prevDist === 0 ? 1 : currentDist / prevDist;
                    
                    // Find group bounding box center
                    const allX = groupShapes.flatMap(s => s.dots.map(d => s.position.x + d.x * s.scale));
                    const allY = groupShapes.flatMap(s => s.dots.map(d => s.position.y + d.y * s.scale));
                    groupStrokes.forEach(st => st.points.forEach(p => { allX.push(p.x); allY.push(p.y); }));
                    const centerX = (Math.min(...allX) + Math.max(...allX)) / 2;
                    const centerY = (Math.min(...allY) + Math.max(...allY)) / 2;
                    
                    // Resize and reposition shapes relative to center
                    setWorkspaceShapes(prev => prev.map(s => {
                      if (s.groupId === shape.groupId) {
                        const dx = s.position.x - centerX;
                        const dy = s.position.y - centerY;
                        return {
                          ...s,
                          scale: Math.max(0.1, s.scale * scaleFactor),
                          position: {
                            x: centerX + dx * scaleFactor,
                            y: centerY + dy * scaleFactor
                          }
                        };
                      }
                      return s;
                    }));
                    
                    // Resize and reposition strokes relative to center
                    setStrokes(prev => prev.map(st => {
                      if (st.groupId === shape.groupId) {
                        return {
                          ...st,
                          points: st.points.map(p => ({
                            ...p,
                            x: centerX + (p.x - centerX) * scaleFactor,
                            y: centerY + (p.y - centerY) * scaleFactor
                          }))
                        };
                      }
                      return st;
                    }));
                  } else {
                    const scaleChange = (c.x - dragOffset.x) / 400;
                    setWorkspaceShapes(prev => prev.map(s => s.id === resizingId ? { ...s, scale: Math.max(0.1, s.scale + scaleChange) } : s));
                  }
                } else if (stroke) {
                  if (stroke.groupId) {
                    // Get all items in the group and calculate group center
                    const groupShapes = workspaceShapes.filter(s => s.groupId === stroke.groupId);
                    const groupStrokes = strokes.filter(st => st.groupId === stroke.groupId);
                    
                    // Find group bounding box center
                    const allX = groupShapes.flatMap(s => s.dots.map(d => s.position.x + d.x * s.scale));
                    const allY = groupShapes.flatMap(s => s.dots.map(d => s.position.y + d.y * s.scale));
                    groupStrokes.forEach(st => st.points.forEach(p => { allX.push(p.x); allY.push(p.y); }));
                    const centerX = (Math.min(...allX) + Math.max(...allX)) / 2;
                    const centerY = (Math.min(...allY) + Math.max(...allY)) / 2;
                    
                    // Calculate scale factor (ratio, not delta)
                    const currentDist = Math.hypot(c.x - centerX, c.y - centerY);
                    const prevDist = Math.hypot(dragOffset.x - centerX, dragOffset.y - centerY);
                    const scaleFactor = prevDist === 0 ? 1 : currentDist / prevDist;
                    
                    // Resize and reposition shapes relative to center
                    setWorkspaceShapes(prev => prev.map(s => {
                      if (s.groupId === stroke.groupId) {
                        const dx = s.position.x - centerX;
                        const dy = s.position.y - centerY;
                        return {
                          ...s,
                          scale: Math.max(0.1, s.scale * scaleFactor),
                          position: {
                            x: centerX + dx * scaleFactor,
                            y: centerY + dy * scaleFactor
                          }
                        };
                      }
                      return s;
                    }));
                    
                    // Resize and reposition strokes relative to center
                    setStrokes(prev => prev.map(st => {
                      if (st.groupId === stroke.groupId) {
                        return {
                          ...st,
                          points: st.points.map(p => ({
                            ...p,
                            x: centerX + (p.x - centerX) * scaleFactor,
                            y: centerY + (p.y - centerY) * scaleFactor
                          }))
                        };
                      }
                      return st;
                    }));
                  } else {
                    // Resize single stroke
                    const allX = stroke.points.map(p => p.x);
                    const allY = stroke.points.map(p => p.y);
                    const centerX = (Math.min(...allX) + Math.max(...allX)) / 2;
                    const centerY = (Math.min(...allY) + Math.max(...allY)) / 2;
                    
                    const currentDist = Math.hypot(c.x - centerX, c.y - centerY);
                    const prevDist = Math.hypot(dragOffset.x - centerX, dragOffset.y - centerY);
                    const scaleFactor = prevDist === 0 ? 1 : currentDist / prevDist;
                    
                    setStrokes(prev => prev.map(st => {
                      if (st.id === resizingId) {
                        return {
                          ...st,
                          points: st.points.map(p => ({
                            ...p,
                            x: centerX + (p.x - centerX) * scaleFactor,
                            y: centerY + (p.y - centerY) * scaleFactor
                          }))
                        };
                      }
                      return st;
                    }));
                  }
                }
                setDragOffset({ x: c.x, y: c.y }); 
              } else if (rotatingId) {
                const shape = workspaceShapes.find(s => s.id === rotatingId);
                const stroke = strokes.find(st => st.id === rotatingId);
                
                if (shape) {
                  const centerX = shape.position.x + (shape.dims.width / 2) * shape.scale;
                  const centerY = shape.position.y + (shape.dims.height / 2) * shape.scale;
                  const angle = Math.atan2(c.y - centerY, c.x - centerX) * (180 / Math.PI);
                  // Add 90 degrees because the handle is at the top
                  setWorkspaceShapes(prev => prev.map(s => s.id === rotatingId ? { ...s, rotation: angle + 90 } : s));
                } else if (stroke) {
                  const allX = stroke.points.map(p => p.x);
                  const allY = stroke.points.map(p => p.y);
                  const centerX = (Math.min(...allX) + Math.max(...allX)) / 2;
                  const centerY = (Math.min(...allY) + Math.max(...allY)) / 2;
                  const angle = Math.atan2(c.y - centerY, c.x - centerX) * (180 / Math.PI);
                  setStrokes(prev => prev.map(st => st.id === rotatingId ? { ...st, rotation: angle + 90 } : st));
                }
              } }} onPointerUp={(e) => { 

                if (activeTool === "scissor") {
                   const currTarget = scissorTargetRef.current;
                   if (currTarget && scissorDots.length >= 3) {
                      saveForUndo();
                      const targetShape = workspaceShapes.find(s => s.id === currTarget);
                      if (targetShape) {
                          const newLocalDots = scissorDots.map((d, i) => {
                             let dx = d.x - targetShape.position.x;
                             let dy = d.y - targetShape.position.y;
                             let sx = dx / targetShape.scale;
                             let sy = dy / targetShape.scale;
                             const cx = targetShape.dims.width / 2;
                             const cy = targetShape.dims.height / 2;
                             const rad = -(targetShape.rotation || 0) * (Math.PI / 180);
                             const localX = (sx - cx) * Math.cos(rad) - (sy - cy) * Math.sin(rad) + cx;
                             const localY = (sx - cx) * Math.sin(rad) + (sy - cy) * Math.cos(rad) + cy;
                             return { id: `pt-sc-${Date.now()}-${i}`, x: localX, y: localY };
                          });
                          setWorkspaceShapes(prev => prev.map(s => s.id === currTarget ? { ...s, dots: newLocalDots, clipUpdate: Date.now() } : s));
                          setActiveTool("cursor");
                      }
                   }
                   setScissorDots([]);
                   scissorTargetRef.current = null;
                   isPointerDownRef.current = false;
                   return;
                }

              // Show context menu for selection rectangle only on right-click
              if (selectionRect && Math.abs(selectionRect.x2 - selectionRect.x1) > 10 && Math.abs(selectionRect.y2 - selectionRect.y1) > 10) {
                if (((e.nativeEvent) as PointerEvent).button === 2 || e.pointerType === 'touch') {
                  setContextMenu({ x: e.clientX, y: e.clientY, id: 'selection', type: 'selection' });
                }
              } else {
                setSelectionRect(null);
              }
              isPointerDownRef.current = false; penRef.current = null; setDraggingShapeId(null); setDraggingStrokeId(null); setDraggingDot(null); setDraggingStrokeDot(null); setResizingId(null); setRotatingId(null); }}>
              
              {/* Wrap the workspace viewport inside a layout branch */}
  {showTryOn && (
  <div className="mt-4 p-4 border border-slate-200 rounded-2xl bg-white shadow-sm flex flex-col items-center w-full max-w-[670px] mx-auto">
    <h3 className="text-sm font-bold text-slate-700 mb-2 uppercase tracking-wide">
      Live Device Try-On Pipeline
    </h3>
    {/* Explicitly passing only the custom baked canvas image */}
    <NecklaceTryOn selectedImageSrc={renderedWorkspaceImg} />
  </div>
)}
            <svg 
              id="workspace-svg" 
              ref={workspaceRef} 
              className={`w-full h-full shadow-2xl rounded-[3rem] lg:rounded-[3rem] rounded-2xl ${getWorkspaceBgClasses()}`} 
              onContextMenu={(e) => {
                e.preventDefault();
                if (selectionRect) {
                  e.stopPropagation();
                  const rect = { x: Math.min(selectionRect.x1, selectionRect.x2), y: Math.min(selectionRect.y1, selectionRect.y2), width: Math.abs(selectionRect.x2 - selectionRect.x1), height: Math.abs(selectionRect.y2 - selectionRect.y1) };
                  const c = getCoords(e);
                  if (c.x >= rect.x && c.x <= rect.x + rect.width && c.y >= rect.y && c.y <= rect.y + rect.height) {
                    setContextMenu({ x: e.clientX, y: e.clientY, id: 'selection', type: 'selection' });
                  }
                }
              }}
            >
              {selectionRect && (
                <rect 
                  x={Math.min(selectionRect.x1, selectionRect.x2)}
                  y={Math.min(selectionRect.y1, selectionRect.y2)}
                  width={Math.abs(selectionRect.x2 - selectionRect.x1)}
                  height={Math.abs(selectionRect.y2 - selectionRect.y1)}
                  fill="rgba(59, 130, 246, 0.1)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="5,5"
                  style={{ cursor: 'context-menu' }}
                />
              )}

              {/* Render shapes and strokes together sorted by zIndex */}
              {[...workspaceShapes.map(s => ({ ...s, type: 'shape' as const })), ...strokes.map(s => ({ ...s, type: 'stroke' as const }))]
                .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
                .map((item, idx) => {
                  if (item.type === 'shape') {
                    const shape = item as DistortableShape;
                    const transform = `translate(${shape.position.x} ${shape.position.y}) scale(${shape.scale}) rotate(${shape.rotation || 0} ${shape.dims.width/2} ${shape.dims.height/2})`;
                    return (
                      <g key={shape.id} transform={transform} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); const c = getCoords(e); setContextMenu({ x: e.clientX, y: e.clientY, id: shape.id, type: "shape", clickX: c.x, clickY: c.y }); }}>
                        {shape.isMannequin ? (
                          <>
                            <defs>
                              <clipPath id={`cl-${shape.id}-${(shape as any).clipUpdate || shape.dots.length}`}><path d={generatePathData(shape.dots, true)} /></clipPath>
                            </defs>
                            <image key={`img-${shape.id}-${(shape as any).clipUpdate || shape.dots.length}`} data-shape-id={shape.id} href={shape.img} width={shape.dims.width} height={shape.dims.height} clipPath={shape.dots && shape.dots.length > 0 ? `url(#cl-${shape.id}-${(shape as any).clipUpdate || shape.dots.length})` : undefined} onPointerDown={(e) => {
                              if (pickColorMode) { e.stopPropagation();
                              const c = getCoords(e); handlePickRemove(shape, c.x, c.y); return; }
                              if (activeTool === "cursor" && !isLocked) { e.stopPropagation();
                              const c = getCoords(e); setDraggingShapeId(shape.id); setDragOffset({ x: c.x - shape.position.x, y: c.y - shape.position.y });
                              }
                            }} onContextMenu={(e) => { e.preventDefault();
                              e.stopPropagation(); const c = getCoords(e); setContextMenu({ x: e.clientX, y: e.clientY, id: shape.id, type: "shape", clickX: c.x, clickY: c.y });
                            }} onClick={(e) => { e.stopPropagation(); setSelectedShapeId(shape.id); }} />
                            {globalShowDots && shape.dots.map((dot) => (<circle key={dot.id} cx={dot.x} cy={dot.y} r={14 / shape.scale} fill="#8b5cf6" stroke="#ffffff" strokeWidth={2 / shape.scale} opacity={0.8} onPointerDown={(e) => { e.stopPropagation(); setDraggingDot({ shapeId: shape.id, dotId: dot.id }); }} />))}
                            {globalShowDots && <rect x={shape.dims.width - 20} y={shape.dims.height - 20} width={45/shape.scale} height={45/shape.scale} fill="#f97316" rx={4} onPointerDown={(e) => { e.stopPropagation(); const c = getCoords(e); setResizingId(shape.id);
                            setDragOffset({ x: c.x, y: c.y }); }} />}
                            {globalShowDots && <circle cx={shape.dims.width / 2} cy={-30} r={20/shape.scale} fill="#10b981" onPointerDown={(e) => { e.stopPropagation();
                              const c = getCoords(e); setRotatingId(shape.id); setDragOffset({ x: c.x, y: c.y });
                            }} />}
                          </>
                        ) : (
                          <>
                            <defs>
                              <clipPath id={`cl-${shape.id}-${(shape as any).clipUpdate || shape.dots.length}`}><path d={generatePathData(shape.dots, true)} /></clipPath>
                              {shape.erasedPaths && shape.erasedPaths.length > 0 && (
                                <mask id={`ms-${shape.id}`} maskUnits="userSpaceOnUse" x="0" y="0" width={shape.dims.width} height={shape.dims.height}>
                                  <rect x={0} y={0} width={shape.dims.width} height={shape.dims.height} fill="white" />
                                  {shape.erasedPaths.map((p, i) => <path key={`er-${i}`} d={p} fill="black" />)}
                                </mask>
                              )}
                            </defs>
                            <image key={`img-${shape.id}-${(shape as any).clipUpdate || shape.dots.length}`} data-shape-id={shape.id} href={shape.img} width={shape.dims.width} height={shape.dims.height} clipPath={shape.dots && shape.dots.length > 0 ? `url(#cl-${shape.id}-${(shape as any).clipUpdate || shape.dots.length})` : undefined} mask={shape.erasedPaths && shape.erasedPaths.length > 0 ? `url(#ms-${shape.id})` : undefined} onPointerDown={(e) => {
                              if (pickColorMode) { e.stopPropagation();
                              const c = getCoords(e); handlePickRemove(shape, c.x, c.y); return; }
                              if (activeTool === "fill") { e.stopPropagation();
                              saveForUndo(); setWorkspaceShapes(prev => prev.map(s => s.id === shape.id ? { ...s, ...(keepOriginalColor ? {} : { baseFill: '#ffffff' }), fillColor: hexToRgba(activeColor, activeFillOpacity), clothType: normalizeFabric(selectedClothType) } : s));
                              return; }
                              if (activeTool === "cursor" && !isLocked) { e.stopPropagation();
                              const c = getCoords(e); setDraggingShapeId(shape.id); setDragOffset({ x: c.x - shape.position.x, y: c.y - shape.position.y });
                              }
                            }} onContextMenu={(e) => { e.preventDefault();
                              e.stopPropagation(); const c = getCoords(e); setContextMenu({ x: e.clientX, y: e.clientY, id: shape.id, type: "shape", clickX: c.x, clickY: c.y });
                            }} onClick={(e) => { e.stopPropagation(); setSelectedShapeId(shape.id); }} />
                            {shape.baseFill && <path d={generatePathData(shape.dots, true)} fill={shape.baseFill} pointerEvents="none" />}
                            {shape.fillColor && shape.clothType && shape.clothType !== 'solid' ?
                            (
                              <>
                                <defs>
                                  {getFabricImagePath(shape.clothType) ? (
                                    <filter id={`colorize-${shape.id}`}>
                                      <feColorMatrix type="matrix" values="
                                        0.33 0.33 0.33 0 0
                                        0.33 0.33 0.33 0 0
                                        0.33 0.33 0.33 0 0
                                        0    0    0    1 0" result="gray" />
                                      <feFlood floodColor={shape.fillColor} result="color" />
                                      <feBlend mode="hard-light" in="color" in2="gray" />
                                    </filter>
                                  ) : null}
                                  <pattern id={`pt-${shape.id}`} patternUnits="userSpaceOnUse" width={getFabricImagePath(shape.clothType) ? 150 : 40} height={getFabricImagePath(shape.clothType) ? 150 : 40}>
                                    {getFabricImagePath(shape.clothType) ?
                                    (
                                      <image href={getFabricImagePath(shape.clothType)!} x="0" y="0" width={150} height={150} preserveAspectRatio="xMidYMid slice" filter={`url(#colorize-${shape.id})`} />
                                    ) : (
                                      <image href={generateTextureDataUrl(shape.fillColor, normalizeFabric(shape.clothType), 64)} x="0" y="0" width={40} height={40} preserveAspectRatio="none" />
                                    )}
                                  </pattern>
                                </defs>
                                <path d={generatePathData(shape.dots, true)} fill={`url(#pt-${shape.id})`} pointerEvents="none" />
                              </>
                            ) : (
                              shape.fillColor && <path d={generatePathData(shape.dots, true)} fill={shape.fillColor} pointerEvents="none" />
                            )}
                            {globalShowDots && shape.dots.map((dot, dotIdx) => (<circle key={dot.id} id={idx === 0 && dotIdx === 0 ? "workspace-dot-0" : undefined} cx={dot.x} cy={dot.y} r={14 / shape.scale} fill="#3b82f6" onPointerDown={(e) => { e.stopPropagation(); setDraggingDot({ shapeId: shape.id, dotId: dot.id });
                            }} />))}
                            {globalShowDots && <rect x={shape.dims.width - 20} y={shape.dims.height - 20} width={45/shape.scale} height={45/shape.scale} fill="#f97316" rx={4} onPointerDown={(e) => { e.stopPropagation();
                              const c = getCoords(e); setResizingId(shape.id); setDragOffset({ x: c.x, y: c.y });
                            }} />}
                            {globalShowDots && <circle cx={shape.dims.width / 2} cy={-30} r={20/shape.scale} fill="#10b981" onPointerDown={(e) => { e.stopPropagation();
                              const c = getCoords(e); setRotatingId(shape.id); setDragOffset({ x: c.x, y: c.y });
                            }} />}
                          </>
                        )}
                      </g>
                    );
                  } else {
                    const s = item as Stroke;
                    const allX = s.points.map(p => p.x);
                    const allY = s.points.map(p => p.y);
                    const centerX = (Math.min(...allX) + Math.max(...allX)) / 2;
                    const centerY = (Math.min(...allY) + Math.max(...allY)) / 2;
                    const transform = `rotate(${s.rotation || 0} ${centerX} ${centerY})`;
                    return (
                    <g key={s.id} transform={transform} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, id: s.id, type: "stroke" }); }}>
                      {s.baseFill && <path d={generatePathData(s.points, s.closed ?? false)} fill={s.baseFill} pointerEvents="none" strokeLinecap="round" strokeLinejoin="round" />}
                      {s.fillColor && s.clothType && s.clothType !== 'solid' ?
                      (
                        <>
                          <defs>
                            {s.clothType === 'gem' ? (
                              <>
                                <linearGradient id={`gem-grad-${s.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
                                  <stop offset="30%" stopColor={s.fillColor} stopOpacity="0.4" />
                                  <stop offset="50%" stopColor={s.fillColor} stopOpacity="0.7" />
                                  <stop offset="100%" stopColor={s.fillColor} stopOpacity="0.2" />
                                </linearGradient>
                                <filter id={`gem-shine-${s.id}`} x="-50%" y="-50%" width="200%" height="200%">
                                  <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
                                  <feOffset in="blur" dx="2" dy="2" result="offsetBlur"/>
                                  <feSpecularLighting in="blur" surfaceScale="5" specularConstant="1.5" specularExponent="40" lightingColor="#ffffff" result="specOut">
                                    <fePointLight x="-5000" y="-10000" z="20000"/>
                                  </feSpecularLighting>
                                  <feComposite in="specOut" in2="SourceAlpha" operator="in" result="specOut"/>
                                  <feMorphology operator="erode" radius="2" in="SourceAlpha" result="eroded" />
                                  <feGaussianBlur in="eroded" stdDeviation="4" result="innerBlur" />
                                  <feComposite in="innerBlur" in2="eroded" operator="arithmetic" k2="2" k3="-1" result="innerGlow" />
                                  <feFlood floodColor="white" floodOpacity="0.5" result="lightFlood" />
                                  <feComposite in="lightFlood" in2="innerGlow" operator="in" result="innerHighlight" />
                                  <feMerge>
                                    <feMergeNode in="SourceGraphic"/>
                                    <feMergeNode in="specOut"/>
                                    <feMergeNode in="innerHighlight"/>
                                  </feMerge>
                                </filter>
                              </>
                            ) : s.clothType === 'bead' || (workspaceShapes.find(ws=>ws.id===s.id)?.clothType === 'bead') ? (
                               <>
                                 <radialGradient id={`bead-grad-${s.id}`} cx="35%" cy="35%" r="60%" fx="30%" fy="30%">
                                   <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                                   <stop offset="20%" stopColor={s.fillColor} stopOpacity="1" />
                                   <stop offset="50%" stopColor={s.fillColor} stopOpacity="1" />
                                   <stop offset="90%" stopColor="#000000" stopOpacity="0.6" />
                                   <stop offset="100%" stopColor="#000000" stopOpacity="0.8" />
                                 </radialGradient>
                                 <filter id={`bead-shine-${s.id}`} x="-50%" y="-50%" width="200%" height="200%">
                                   <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur" />
                                   <feSpecularLighting in="blur" surfaceScale="5" specularConstant="1.5" specularExponent="25" lightingColor="#ffffff" result="specOut">
                                     <fePointLight x="-5000" y="-10000" z="20000"/>
                                   </feSpecularLighting>
                                   <feComposite in="specOut" in2="SourceAlpha" operator="in" result="specOut"/>
                                   <feDropShadow dx="2" dy="2" stdDeviation="2" floodColor="#000000" floodOpacity="0.5" />
                                   <feMerge>
                                     <feMergeNode in="SourceGraphic"/>
                                     <feMergeNode in="specOut"/>
                                   </feMerge>
                                 </filter>
                               </>
                            ) : getFabricImagePath(s.clothType) ? (
                              <filter id={`colorize-stroke-${s.id}`}>
                                <feColorMatrix type="matrix" values="
                                  0.33 0.33 0.33 0 0
                                  0.33 0.33 0.33 0 0
                                  0.33 0.33 0.33 0 0
                                  0    0    0    1 0" result="gray" />
                                <feFlood floodColor={s.fillColor} result="color" />
                                <feBlend mode="hard-light" in="color" in2="gray" />
                              </filter>
                            ) : null}
                            {s.clothType !== 'gem' && (
                              <pattern id={`pt-stroke-${s.id}`} patternUnits="userSpaceOnUse" width={getFabricImagePath(s.clothType) ? 150 : 40} height={getFabricImagePath(s.clothType) ? 150 : 40}>
                              {getFabricImagePath(s.clothType) ? (
                                <image href={getFabricImagePath(s.clothType)!} x="0" y="0" width={150} height={150} preserveAspectRatio="xMidYMid slice" filter={`url(#colorize-stroke-${s.id})`} />
                              ) : (
                                <image href={generateTextureDataUrl(s.fillColor, normalizeFabric(s.clothType || 'cotton'), 64)} x="0" y="0" width={40} height={40} preserveAspectRatio="none" />
                              )}
                            </pattern>
                            )}
                          </defs>
                          {s.clothType === 'gem' ?
                          (
                             <path d={generatePathData(s.points, s.closed ?? false)}
                                  stroke={s.visible === false ? (globalShowDots ? s.color : "transparent") : s.color}
                                  strokeWidth={s.width / 2}
                                  fill={`url(#gem-grad-${s.id})`}
                                  opacity={0.9}
                                  onPointerDown={(e) => {
                                    if (activeTool === "fill") {
                                      e.stopPropagation();
                                      saveForUndo();
                                      setStrokes(prev => prev.map(st => st.id === s.id ? { ...st, ...(keepOriginalColor ? {} : { baseFill: '#ffffff' }), fillColor: hexToRgba(activeColor, activeFillOpacity), clothType: normalizeFabric(selectedClothType) } : st));
                                    } else if (activeTool === "cursor" && !isLocked) {
                                      e.stopPropagation();
                                      const c = getCoords(e);
                                      setDraggingStrokeId(s.id);
                                      setDragOffset({ x: c.x, y: c.y });
                                    }
                                  }}
                                  onContextMenu={(e) => { e.preventDefault();
                                    e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, id: s.id, type: "stroke" });
                                  }}
                                  filter={`url(#gem-shine-${s.id})`}
                             />
                          ) : s.clothType && s.clothType.startsWith('asset:') ?
                          (
                            <image
                              href={`/assets/${s.clothType.split(':')[1]}`}
                              x={Math.min(...s.points.map(p => p.x))}
                              y={Math.min(...s.points.map(p => p.y))}
                              width={Math.max(...s.points.map(p => p.x)) - Math.min(...s.points.map(p => p.x))}
                              height={Math.max(...s.points.map(p => p.y)) - Math.min(...s.points.map(p => p.y))}
                              onPointerDown={(e) => {
                                  if (activeTool === "fill") {
                                  } else if (activeTool === "cursor" && !isLocked) {
                                    e.stopPropagation();
                                    const c = getCoords(e);
                                    setDraggingStrokeId(s.id);
                                    setDragOffset({ x: c.x, y: c.y });
                                  }
                                }}
                              onContextMenu={(e) => { e.preventDefault();
                                e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, id: s.id, type: "stroke" });
                              }}
                            />
                          ) : s.clothType === 'real-bead' ?
                          (
                            <image
                              href="/assets/bead.png"
                              x={Math.min(...s.points.map(p => p.x))}
                              y={Math.min(...s.points.map(p => p.y))}
                              width={Math.max(...s.points.map(p => p.x)) - Math.min(...s.points.map(p => p.x))}
                              height={Math.max(...s.points.map(p => p.y)) - Math.min(...s.points.map(p => p.y))}
                              onPointerDown={(e) => {
                                  if (activeTool === "fill") {
                                    e.stopPropagation();
                                    saveForUndo();
                                    setStrokes(prev => prev.map(st => st.id === s.id ? { ...st, ...(keepOriginalColor ? {} : { baseFill: '#ffffff' }), fillColor: hexToRgba(activeColor, activeFillOpacity), clothType: normalizeFabric(selectedClothType) } : st));
                                  } else if (activeTool === "cursor" && !isLocked) {
                                    e.stopPropagation();
                                    const c = getCoords(e);
                                    setDraggingStrokeId(s.id);
                                    setDragOffset({ x: c.x, y: c.y });
                                  }
                                }}
                              onContextMenu={(e) => { e.preventDefault();
                                e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, id: s.id, type: "stroke" });
                              }}
                              preserveAspectRatio="none"
                            />
                          ) : s.clothType === 'real-emerald' ?
                          (
                            <image
                              href="/assets/emerald.png"
                              x={Math.min(...s.points.map(p => p.x))}
                              y={Math.min(...s.points.map(p => p.y))}
                              width={Math.max(...s.points.map(p => p.x)) - Math.min(...s.points.map(p => p.x))}
                              height={Math.max(...s.points.map(p => p.y)) - Math.min(...s.points.map(p => p.y))}
                              onPointerDown={(e) => {
                                  if (activeTool === "fill") {
                                    e.stopPropagation();
                                    saveForUndo();
                                    setStrokes(prev => prev.map(st => st.id === s.id ? { ...st, ...(keepOriginalColor ? {} : { baseFill: '#ffffff' }), fillColor: hexToRgba(activeColor, activeFillOpacity), clothType: normalizeFabric(selectedClothType) } : st));
                                  } else if (activeTool === "cursor" && !isLocked) {
                                    e.stopPropagation();
                                    const c = getCoords(e);
                                    setDraggingStrokeId(s.id);
                                    setDragOffset({ x: c.x, y: c.y });
                                  }
                                }} 
                              onContextMenu={(e) => { e.preventDefault();
                                e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, id: s.id, type: "stroke" });
                              }}
                              preserveAspectRatio="none"
                            />
                          ) : s.clothType === 'bead' || (workspaceShapes.find(ws=>ws.id===s.id)?.clothType === 'bead') ? (
                             <path d={generatePathData(s.points, s.closed ?? false)}
                                  stroke="none"
                                  fill={`url(#bead-grad-${s.id})`}
                                  onPointerDown={(e) => {
                                      if (activeTool === "fill") {
                                        e.stopPropagation();
                                        saveForUndo();
                                        setStrokes(prev => prev.map(st => st.id === s.id ? { ...st, ...(keepOriginalColor ? {} : { baseFill: '#ffffff' }), fillColor: hexToRgba(activeColor, activeFillOpacity), clothType: normalizeFabric(selectedClothType) } : st));
                                      } else if (activeTool === "cursor" && !isLocked) {
                                        e.stopPropagation();
                                        const c = getCoords(e);
                                        setDraggingStrokeId(s.id);
                                        setDragOffset({ x: c.x, y: c.y });
                                      }
                                    }} 
                                  onContextMenu={(e) => { e.preventDefault();
                                    e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, id: s.id, type: "stroke" });
                                  }}
                                  filter={`url(#bead-shine-${s.id})`}
                             />
                          ) : s.clothType === 'button' ?
                          (
                            <g onPointerDown={(e) => {
                              if (activeTool === "fill") {
                                e.stopPropagation();
                                saveForUndo();
                                setStrokes(prev => prev.map(st => st.id === s.id ? { ...st, ...(keepOriginalColor ? {} : { baseFill: '#ffffff' }), fillColor: hexToRgba(activeColor, activeFillOpacity), clothType: normalizeFabric(selectedClothType) } : st));
                              } else if (activeTool === "cursor" && !isLocked) {
                                  e.stopPropagation();
                                  const c = getCoords(e);
                                  setDraggingStrokeId(s.id);
                                  setDragOffset({ x: c.x, y: c.y });
                                }
                              }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, id: s.id, type: "stroke" }); }} opacity={s.visible === false ? 0.3 : 1}>
                                <defs>
                                  <radialGradient id={`btn-grad-${s.id}`} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                                    <stop offset="70%" stopColor={s.fillColor} />
                                    <stop offset="95%" stopColor="#000000" stopOpacity="0.2" />
                                    <stop offset="100%" stopColor="#000000" stopOpacity="0.5" />
                                  </radialGradient>
                                  <filter id={`btn-shadow-${s.id}`}>
                                      <feDropShadow dx="1" dy="2" stdDeviation="1" floodOpacity="0.3"/>
                                  </filter>
                                </defs>
                                <path d={generatePathData(s.points, true)} fill={`url(#btn-grad-${s.id})`} stroke={s.color} strokeWidth={1} filter={`url(#btn-shadow-${s.id})`}/>
                                <path d={generatePathData(s.points, true)} fill="none" stroke="white" strokeWidth={2} strokeOpacity="0.3" transform="scale(0.95)" transform-origin="center" />
                            </g>
                          ) : (
                              <path d={generatePathData(s.points, s.closed ?? false)}
                                stroke={s.visible === false ? (globalShowDots ? s.color : "transparent") : s.color}
                                strokeWidth={s.width}
                                fill={`url(#pt-stroke-${s.id})`}
                                strokeLinecap="round" strokeLinejoin="round"
                                strokeDasharray={s.visible === false ? "5,5" : undefined}
                                opacity={s.visible === false ? 0.3 : 1}
                              />
                            )}
                        </>
                      ) : (
                        <path d={generatePathData(s.points, s.closed ?? false)} stroke={s.visible === false ? (globalShowDots ? s.color : "transparent") : s.color} strokeWidth={s.width} fill={s.fillColor || "transparent"} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.visible === false ? "5,5" : undefined} opacity={s.visible === false ? 0.3 : 1} onPointerDown={(e) => { if (activeTool === "fill") { e.stopPropagation(); saveForUndo(); setStrokes(prev => prev.map(st => st.id === s.id ? { ...st, ...(keepOriginalColor ? {} : { baseFill: '#ffffff' }), fillColor: hexToRgba(activeColor, activeFillOpacity), clothType: normalizeFabric(selectedClothType) } : st)); } else if (activeTool === "cursor" && !isLocked) { e.stopPropagation(); const c = getCoords(e); setDraggingStrokeId(s.id); setDragOffset({ x: c.x, y: c.y }); } }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, id: s.id, type: "stroke" }); }} />
                      )}
                      {globalShowDots && s.points.map((p) => (
                        <circle key={p.id} cx={p.x} cy={p.y} r={8} fill={s.color} onPointerDown={(e) => { if (activeTool === "cursor") { e.stopPropagation(); setDraggingStrokeDot({ strokeId: s.id, dotId: p.id }); } }} />
                      ))}
                      {globalShowDots && (() => {
                        const allX = s.points.map(p => p.x);
                        const allY = s.points.map(p => p.y);
                        const maxX = Math.max(...allX);
                        const maxY = Math.max(...allY);
                        const minX = Math.min(...allX);
                        const minY = Math.min(...allY);
                        const centerX = (minX + maxX) / 2;
                        return (
                          <>
                            <rect x={maxX + 10} y={maxY + 10} width={45} height={45} fill="#f97316" rx={4} onPointerDown={(e) => { e.stopPropagation(); const c = getCoords(e); setResizingId(s.id); setDragOffset({ x: c.x, y: c.y }); }} />
                            <circle cx={centerX} cy={minY - 30} r={20} fill="#10b981" onPointerDown={(e) => { e.stopPropagation(); const c = getCoords(e); setRotatingId(s.id); setDragOffset({ x: c.x, y: c.y }); }} />
                          </>
                        );
                      })()}
                    </g>
                    );
                  }
                })}

              {activeTool === "scissor" && scissorDots.length > 0 && (
                <g pointerEvents="none">
                  {scissorDots.length > 2 && (
                    <polygon 
                      points={scissorDots.map(d => `${d.x},${d.y}`).join(' ')} 
                      fill="rgba(168, 85, 247, 0.4)" 
                      stroke="#c084fc" 
                      strokeWidth="2" 
                      strokeDasharray="4 4"
                    />
                  )}
                  {scissorDots.length <= 2 && scissorDots.length > 1 && (
                    <polyline 
                      points={scissorDots.map(d => `${d.x},${d.y}`).join(' ')} 
                      fill="none" 
                      stroke="#c084fc" 
                      strokeWidth="2" 
                      strokeDasharray="4 4"
                    />
                  )}
                  {scissorDots.map((dot, i) => (
                    <circle 
                      key={`sc-${i}`} 
                      cx={dot.x} 
                      cy={dot.y} 
                      r={4} 
                      fill="#a855f7" 
                      stroke="white" 
                      strokeWidth="1.5" 
                    />
                  ))}
                </g>
              )}
              
              {/* Highlight selected shape */}
              {selectedShapeId && workspaceShapes?.map(s => s.id === selectedShapeId ? (
                <g key={s.id + '-highlight'}>
                  <rect
                    x={s.position.x - 8}
                    y={s.position.y - 8}
                    width={s.dims.width * s.scale + 16}
                    height={s.dims.height * s.scale + 16}
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth={4}
                    strokeDasharray="8 4"
                    pointerEvents="none"
                  />
                </g>
              ) : null)}
            </svg>
          

          </div>
          {/* Tutorial UI Assist Controls */}
          <button onClick={runTutorial} disabled={tutorialDisabled} className="fixed bottom-6 right-6 w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-500 text-white rounded-full font-black shadow-2xl border-4 border-white hover:scale-110 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">?</button>
        </main>

        </div>
        {/* Footer Refine UI */}
        <div className="w-full flex flex-col md:flex-row items-center gap-2 px-4 py-3 bg-white border-t border-slate-200 shadow-inner z-50 sticky bottom-0">
          {refineError && (
            <div className="w-full text-red-600 text-xs mb-1 text-center">{refineError}</div>
          )}
          <input
            type="text"
            placeholder="Enter prompt to refine image..."
            value={refinePrompt}
            onChange={e => setRefinePrompt(e.target.value)}
            className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm"
            disabled={isRefiningImage}
          />
          <button
            onClick={handleRefineImage}
            disabled={isRefiningImage || !refinePrompt || !selectedShape}
            className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-md text-sm font-bold uppercase shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isRefiningImage ? (
              <>
                <span className="animate-spin">⏳</span> Refining...
              </>
            ) : (
              <>🪄 Refine Image</>
            )}
          </button>
          <button
  onClick={() => setShowTryOn(prev => !prev)}
  className={`px-5 py-2.5 rounded-xl font-bold text-white shadow-md transition-all active:scale-95 flex items-center gap-2 ${
    showTryOn 
      ? 'bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700' 
      : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
  }`}
>
  {showTryOn ? (
    <>
      <span>🎨</span> Return to Studio Canvas
    </>
  ) : (
    <>
      <span>📸</span> Open Live Try-On
    </>
  )}
</button>
        </div>
        <AdBanner />
        <SubmissionModal
          isOpen={showSubmissionModal}
          onClose={() => setShowSubmissionModal(false)}
          getDesignImage={getDesignImage}
        />
      </div>
  );
}

