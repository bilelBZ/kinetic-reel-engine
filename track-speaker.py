#!/usr/bin/env python3
"""
track-speaker.py — camera-follow speaker tracking for vertical news reels.

Samples frames from a landscape source clip, detects the speaker's face
(YuNet DNN), and re-crops every frame to 9:16 with a smoothly-following
window, like a cameraman panning to keep the talker centered.

Usage:
    track-speaker.py --input section.mp4 --output followed.mp4 \
        [--model models/face_detection_yunet.onnx] [--sample-fps 4]

Fallback: if faces are found in <20% of samples (no clear speaker),
the clip is center-cropped statically and the script exits 0 with a
"FALLBACK_STATIC" marker on stdout so the caller knows.
"""
import argparse, json, math, os, subprocess, sys

import cv2
import numpy as np

TARGET_ASPECT = 9.0 / 16.0


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_streams", "-select_streams", "v:0", path],
        capture_output=True, text=True, check=True)
    s = json.loads(out.stdout)["streams"][0]
    fps = eval(s.get("avg_frame_rate", "25/1"))
    return (int(s["width"]), int(s["height"]), float(fps),
            float(s.get("duration", 0)) or None)


def detect_faces_yunet(model_path, frame):
    det = cv2.FaceDetectorYN.create(
        model_path, "", (frame.shape[1], frame.shape[0]),
        score_threshold=0.6, nms_threshold=0.3, top_k=5)
    ok, faces = det.detect(frame)
    if not ok or faces is None:
        return []
    # (x, y, w, h, ...) — keep boxes with sane size
    H, W = frame.shape[:2]
    boxes = []
    for f in faces:
        x, y, w, h = f[:4]
        if w > W * 0.04 and h > H * 0.04:
            boxes.append((x, y, w, h))
    return boxes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--model", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "models", "face_detection_yunet.onnx"))
    ap.add_argument("--sample-fps", type=float, default=4.0)
    args = ap.parse_args()

    W, H, fps, duration = probe(args.input)

    # Already vertical or square-ish: nothing to follow.
    if W / H <= TARGET_ASPECT + 0.01:
        print("SKIP_VERTICAL")
        subprocess.run(["cp", args.input, args.output], check=True)
        return

    win_w = int(H * TARGET_ASPECT)
    win_h = H
    max_x = W - win_w

    cap = cv2.VideoCapture(args.input)
    nframes = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or int((duration or 0) * fps)
    if nframes <= 0:
        print("FALLBACK_STATIC")
        subprocess.run(["cp", args.input, args.output], check=True)
        return

    # --- 1. sample face positions -------------------------------------
    step = max(1, int(round(fps / args.sample_fps)))
    samples = {}  # frame_idx -> face center x (px) or None
    idx = 0
    hits = 0
    tried = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % step == 0:
            tried += 1
            boxes = detect_faces_yunet(args.model, frame)
            if boxes:
                # largest face = main speaker
                x, y, w, h = max(boxes, key=lambda b: b[2] * b[3])
                samples[idx] = x + w / 2.0
                hits += 1
            else:
                samples[idx] = None
        idx += 1
    cap.release()

    hit_rate = hits / max(1, tried)
    print(f"face samples: {hits}/{tried} ({hit_rate:.0%})", file=sys.stderr)
    if hit_rate < 0.20:
        print("FALLBACK_STATIC")
        # static center crop, keep pipeline shape identical
        cx = W / 2.0
        x0 = int(max(0, min(max_x, cx - win_w / 2)))
        subprocess.run([
            "ffmpeg", "-y", "-v", "error", "-i", args.input,
            "-vf", f"crop={win_w}:{win_h}:{x0}:0",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            args.output], check=True)
        return

    # --- 2. per-frame target x (interpolate + hold last) ---------------
    sample_idx = sorted(samples.keys())
    target = np.zeros(nframes)
    last_known = None
    # forward fill seed: first known value, else center
    first_known = next((samples[i] for i in sample_idx if samples[i] is not None), None)
    if first_known is None:
        first_known = W / 2.0
    for f in range(nframes):
        # nearest sample at or before f
        s = max([i for i in sample_idx if i <= f], default=sample_idx[0])
        v = samples[s]
        if v is not None:
            last_known = v
        target[f] = last_known if last_known is not None else first_known

    # --- 3. cameraman smoothing: EMA + dead zone + max pan speed -------
    alpha = 0.10                      # EMA factor per frame (25-30fps)
    dead = 0.03 * W                   # don't move for tiny shifts
    max_step = 0.45 * W / fps         # max pan speed px/frame
    xs = np.zeros(nframes)
    cur = max(0, min(max_x, target[0] - win_w / 2))
    for f in range(nframes):
        desired = max(0, min(max_x, target[f] - win_w / 2))
        if abs(desired - cur) > dead:
            cur += (desired - cur) * alpha
            # clamp pan speed
            prev = xs[f - 1] if f > 0 else cur
            d = cur - prev
            if abs(d) > max_step:
                cur = prev + math.copysign(max_step, d)
        xs[f] = cur
    xs = np.round(xs).astype(int)

    # --- 4. crop every frame, pipe to ffmpeg ---------------------------
    cap = cv2.VideoCapture(args.input)
    ff = subprocess.Popen([
        "ffmpeg", "-y", "-v", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{win_w}x{win_h}", "-r", f"{fps:.3f}", "-i", "-",
        "-i", args.input,
        "-map", "0:v", "-map", "1:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        args.output], stdin=subprocess.PIPE)
    f = 0
    while True:
        ret, frame = cap.read()
        if not ret or f >= nframes:
            break
        x0 = int(xs[f])
        crop = frame[0:win_h, x0:x0 + win_w]
        ff.stdin.write(crop.tobytes())
        f += 1
    cap.release()
    ff.stdin.close()
    ff.wait()
    print(f"FOLLOW_OK frames={f} win={win_w}x{win_h}")


if __name__ == "__main__":
    main()
