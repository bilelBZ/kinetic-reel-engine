# models/

Binary model for `track-speaker.py` (camera-follow speaker tracking).

## face_detection_yunet.onnx

YuNet face detector (2023mar), ~227 KB, Apache-2.0 (OpenCV Zoo).

Download:
```bash
curl -skSL -o models/face_detection_yunet.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
```

The file is intentionally not committed (binary). `track-speaker.py`
expects it at `models/face_detection_yunet.onnx` relative to the repo root.
