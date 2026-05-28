"""
    cd "/Users/riyabrar/Documents/y2/code code code"
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11 necklace_tryon.py

controls:
    N  → next necklace
    B  → previous necklace
    U  → move necklace UP
    J  → move necklace DOWN
    +  → make necklace bigger
    -  → make necklace smaller
    R  → reset size & position
    S  → save screenshot
    Q  → quit
"""

import cv2
import mediapipe as mp
import numpy as np
import os

NECKLACE_FILES = [
    "necklace1.png",
    "necklace2.png",
    "necklace3.png",
    "necklace4.png",
    "necklace5.png",
    "design1.png",
    "design2.png",
    "design3.png"
]

# Starting values — tweak these if necklace is off on first run
SCALE_MULTIPLIER  = 1    # necklace width relative to shoulder width (smaller = tighter fit)
VERTICAL_OFFSET   = 0.0    # positive = lower, negative = higher
# ─────────────────────────────────────────────────────────────────────────────


def load_necklaces(files):
    loaded = []
    for f in files:
        if os.path.exists(f):
            img = cv2.imread(f, cv2.IMREAD_UNCHANGED)
            if img is not None:
                if img.shape[2] == 3:
                    alpha = np.ones(img.shape[:2], dtype=img.dtype) * 255
                    img = cv2.merge([img, alpha])
                loaded.append((f, img))
            else:
                print(f"[warn] Could not read: {f}")
        else:
            print(f"[warn] Not found: {f}")
    return loaded


def overlay_png(background, overlay, x, y, w, h):
    if w <= 0 or h <= 0:
        return background
    overlay_resized = cv2.resize(overlay, (w, h), interpolation=cv2.INTER_AREA)
    bh, bw = background.shape[:2]
    x1, y1 = x, y
    x2, y2 = x + w, y + h
    ox1 = max(0, -x1); oy1 = max(0, -y1)
    x1 = max(0, x1);   y1 = max(0, y1)
    x2 = min(bw, x2);  y2 = min(bh, y2)
    if x2 <= x1 or y2 <= y1:
        return background
    ow = x2 - x1
    oh = y2 - y1
    roi   = background[y1:y2, x1:x2]
    patch = overlay_resized[oy1:oy1+oh, ox1:ox1+ow]
    if patch.shape[2] == 4:
        alpha     = patch[:, :, 3:4].astype(np.float32) / 255.0
        patch_bgr = patch[:, :, :3].astype(np.float32)
        blended   = (patch_bgr * alpha + roi.astype(np.float32) * (1 - alpha)).astype(np.uint8)
        background[y1:y2, x1:x2] = blended
    else:
        background[y1:y2, x1:x2] = patch
    return background


def get_point(landmarks, idx, w, h):
    lm = landmarks.landmark[idx]
    return int(lm.x * w), int(lm.y * h)


def main():
    necklaces = load_necklaces(NECKLACE_FILES)
    if not necklaces:
        print("No necklace images loaded.")
        return

    current_idx   = 0
    scale_mult    = SCALE_MULTIPLIER
    vert_offset   = VERTICAL_OFFSET
    scale_step    = 0.05
    offset_step   = 0.03

    mp_pose = mp.solutions.pose
    pose = mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        min_detection_confidence=0.6,
        min_tracking_confidence=0.6,
    )

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Error: Cannot access webcam.")
        return

    print("\nVirtual Necklace Try-On started!")
    print("  N / B  → next / previous necklace")
    print("  U / J  → move necklace up / down")
    print("  + / -  → bigger / smaller")
    print("  R      → reset adjustments")
    print("  S      → save screenshot")
    print("  Q      → quit\n")

    screenshot_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.flip(frame, 1)
        fh, fw = frame.shape[:2]

        rgb     = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose.process(rgb)

        name, necklace_img = necklaces[current_idx]

        if results.pose_landmarks:
            lm = results.pose_landmarks

            ls   = get_point(lm, 11, fw, fh)   # left shoulder
            rs   = get_point(lm, 12, fw, fh)   # right shoulder
            nose = get_point(lm, 0,  fw, fh)   # nose

            mid_x = (ls[0] + rs[0]) // 2
            mid_y = (ls[1] + rs[1]) // 2

            shoulder_width = abs(rs[0] - ls[0])
            necklace_w = int(shoulder_width * scale_mult)
            aspect     = necklace_img.shape[0] / necklace_img.shape[1]
            necklace_h = int(necklace_w * aspect)

            # Neck position: between nose and shoulders
            neck_y = int(nose[1] + (mid_y - nose[1]) * (0.62 + vert_offset))

            nx = mid_x - necklace_w // 2
            ny = neck_y - necklace_h // 6

            frame = overlay_png(frame, necklace_img, nx, ny, necklace_w, necklace_h)

        # HUD bar
        cv2.rectangle(frame, (0, 0), (fw, 40), (0, 0, 0), -1)
        label = f"[{current_idx+1}/{len(necklaces)}] {os.path.basename(name)}  |  scale:{scale_mult:.2f}  offset:{vert_offset:.2f}"
        cv2.putText(frame, label, (10, 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, "N/B=switch  U/J=up/down  +/-=size  R=reset  S=save  Q=quit",
                    (10, fh - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (200, 200, 200), 1, cv2.LINE_AA)

        cv2.imshow("Virtual Necklace Try-On", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('n'):
            current_idx = (current_idx + 1) % len(necklaces)
        elif key == ord('b'):
            current_idx = (current_idx - 1) % len(necklaces)
        elif key == ord('u'):
            vert_offset -= offset_step      # move up
        elif key == ord('j'):
            vert_offset += offset_step      # move down
        elif key in (ord('+'), ord('=')):
            scale_mult += scale_step        # bigger
        elif key == ord('-'):
            scale_mult = max(0.1, scale_mult - scale_step)  # smaller
        elif key == ord('r'):
            scale_mult  = SCALE_MULTIPLIER  # reset
            vert_offset = VERTICAL_OFFSET
        elif key == ord('s'):
            screenshot_count += 1
            fname = f"screenshot_{screenshot_count}.png"
            cv2.imwrite(fname, frame)
            print(f"Saved {fname}")

    cap.release()
    cv2.destroyAllWindows()
    pose.close()
    print("Closed.")


if __name__ == "__main__":
    main()
