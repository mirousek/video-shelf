from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path

import ffmpeg

from app.config import settings
from app.models.schemas import CutSegment, VideoInfo

logger = logging.getLogger(__name__)


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"}


def is_image(file_path: Path) -> bool:
    return file_path.suffix.lower() in IMAGE_EXTENSIONS


def probe_image(file_path: Path) -> VideoInfo:
    """Extract image metadata using ffprobe."""
    try:
        info = ffmpeg.probe(str(file_path), cmd=settings.ffprobe_path)
    except ffmpeg.Error as e:
        raise ValueError(f"Failed to probe image: {e.stderr}") from e

    video_stream = next(
        (s for s in info["streams"] if s["codec_type"] == "video"),
        None,
    )
    if video_stream is None:
        raise ValueError("Cannot read image dimensions")

    return VideoInfo(
        filename=Path(file_path).name,
        duration=0,
        width=int(video_stream["width"]),
        height=int(video_stream["height"]),
        codec="image",
        fps=0,
        size_bytes=int(info["format"].get("size", 0)),
        media_type="image",
    )


def probe(file_path: Path) -> VideoInfo:
    """Extract video metadata using ffprobe."""
    try:
        info = ffmpeg.probe(str(file_path), cmd=settings.ffprobe_path)
    except ffmpeg.Error as e:
        raise ValueError(f"Failed to probe video: {e.stderr}") from e

    video_stream = next(
        (s for s in info["streams"] if s["codec_type"] == "video"),
        None,
    )
    if video_stream is None:
        raise ValueError("No video stream found in file")

    duration = float(info["format"].get("duration", 0))
    fps_parts = video_stream.get("r_frame_rate", "30/1").split("/")
    fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else 30.0

    return VideoInfo(
        filename=Path(file_path).name,
        duration=duration,
        width=int(video_stream["width"]),
        height=int(video_stream["height"]),
        codec=video_stream["codec_name"],
        fps=round(fps, 2),
        size_bytes=int(info["format"].get("size", 0)),
    )


def _are_streams_compatible(paths: list[Path]) -> bool:
    """Check if all files share the same resolution, codec, fps, and pixel format."""
    if len(paths) <= 1:
        return True
    infos = [probe(p) for p in paths]
    ref = infos[0]
    return all(
        i.width == ref.width
        and i.height == ref.height
        and i.codec == ref.codec
        and i.fps == ref.fps
        for i in infos[1:]
    )


def cut_segment(
    input_path: Path,
    segment: CutSegment,
    output_path: Path,
    output_format: str = "mp4",
    force_reencode: bool = False,
    crf: int = 18,
    preset: str = "medium",
) -> Path:
    """Cut a single segment. Uses stream copy when possible, re-encodes when forced or on failure."""
    if not force_reencode:
        try:
            (
                ffmpeg.input(str(input_path), ss=segment.start, to=segment.end)
                .output(str(output_path), c="copy", movflags="+faststart", format=output_format)
                .overwrite_output()
                .run(cmd=settings.ffmpeg_path, capture_stdout=True, capture_stderr=True)
            )
            return output_path
        except ffmpeg.Error as e:
            logger.warning("Stream copy failed, falling back to re-encode: %s", e.stderr)

    _reencode_segment(input_path, segment, output_path, output_format, crf=crf, preset=preset)
    return output_path


def cut_segment_normalized(
    input_path: Path,
    segment: CutSegment,
    output_path: Path,
    width: int,
    height: int,
    fps: float,
    output_format: str = "mp4",
    crf: int = 18,
    preset: str = "medium",
) -> Path:
    """Cut and re-encode a segment, normalizing to a target resolution and frame rate.

    Uses scale+pad to fit any aspect ratio into the target frame without cropping.
    Video filters are applied to the video stream only; audio is re-encoded separately.
    """
    inp = ffmpeg.input(str(input_path), ss=segment.start, to=segment.end)
    v = (
        inp.video
        .filter("fps", fps=fps)
        .filter("scale", width, height, force_original_aspect_ratio="decrease")
        .filter("pad", width, height, "(ow-iw)/2", "(oh-ih)/2")
        .filter("setsar", "1")
    )
    a = inp.audio
    (
        ffmpeg.output(
            v, a,
            str(output_path),
            vcodec="libx264",
            acodec="aac",
            preset=preset,
            crf=crf,
            movflags="+faststart",
            format=output_format,
            **{"ar": "48000", "ac": "2"},
        )
        .overwrite_output()
        .run(cmd=settings.ffmpeg_path, capture_stdout=True, capture_stderr=True)
    )
    return output_path


def _reencode_segment(
    input_path: Path,
    segment: CutSegment,
    output_path: Path,
    output_format: str,
    crf: int = 18,
    preset: str = "medium",
) -> None:
    (
        ffmpeg.input(str(input_path), ss=segment.start, to=segment.end)
        .output(
            str(output_path),
            vcodec="libx264",
            acodec="aac",
            preset=preset,
            crf=crf,
            movflags="+faststart",
            format=output_format,
        )
        .overwrite_output()
        .run(cmd=settings.ffmpeg_path, capture_stdout=True, capture_stderr=True)
    )


def concat_segments(segment_paths: list[Path], output_path: Path, output_format: str, crf: int = 18, preset: str = "medium") -> Path:
    """Concatenate segments. Uses fast concat demuxer if streams are compatible,
    otherwise falls back to filter-based concat with re-encoding."""
    if _are_streams_compatible(segment_paths):
        return _concat_demuxer(segment_paths, output_path, output_format)
    return _concat_filter(segment_paths, output_path, output_format, crf=crf, preset=preset)


def _concat_demuxer(segment_paths: list[Path], output_path: Path, output_format: str) -> Path:
    """Fast concatenation via concat demuxer (requires identical stream parameters)."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        for p in segment_paths:
            f.write(f"file '{p}'\n")
        concat_list = f.name

    try:
        cmd = [
            settings.ffmpeg_path, "-y",
            "-f", "concat", "-safe", "0", "-i", concat_list,
            "-c", "copy", "-movflags", "+faststart",
            "-f", output_format, str(output_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"Concat demuxer failed: {result.stderr}")
    finally:
        Path(concat_list).unlink(missing_ok=True)

    return output_path


def _concat_filter(segment_paths: list[Path], output_path: Path, output_format: str, crf: int = 18, preset: str = "medium") -> Path:
    """Safe concatenation via the concat filter — re-encodes everything to match."""
    inputs = [ffmpeg.input(str(p)) for p in segment_paths]

    (
        ffmpeg.concat(*[stream for inp in inputs for stream in (inp.video, inp.audio)], v=1, a=1)
        .output(
            str(output_path),
            vcodec="libx264",
            acodec="aac",
            preset=preset,
            crf=crf,
            movflags="+faststart",
            format=output_format,
            **{"ar": "48000", "ac": "2"},
        )
        .overwrite_output()
        .run(cmd=settings.ffmpeg_path, capture_stdout=True, capture_stderr=True)
    )
    return output_path


def image_to_video(
    image_path: Path,
    output_path: Path,
    duration: float,
    width: int,
    height: int,
    fps: float = 30.0,
    output_format: str = "mp4",
    crf: int = 18,
    preset: str = "medium",
) -> Path:
    """Convert a static image to a video segment with the given duration.

    Scales the image to fit within width×height preserving aspect ratio,
    with black letterbox/pillarbox padding. Adds a silent audio track
    for seamless concatenation with video clips.
    """
    v = (
        ffmpeg.input(str(image_path), loop=1, t=duration)
        .filter("fps", fps=fps)
        .filter("scale", width, height, force_original_aspect_ratio="decrease")
        .filter("pad", width, height, "(ow-iw)/2", "(oh-ih)/2")
        .filter("setsar", "1")
    )
    a = ffmpeg.input("anullsrc", f="lavfi", t=duration).audio
    (
        ffmpeg.output(
            v, a,
            str(output_path),
            vcodec="libx264",
            acodec="aac",
            pix_fmt="yuv420p",
            preset=preset,
            crf=crf,
            movflags="+faststart",
            format=output_format,
            shortest=None,
            **{"ar": "48000", "ac": "2"},
        )
        .overwrite_output()
        .run(cmd=settings.ffmpeg_path, capture_stdout=True, capture_stderr=True)
    )
    return output_path


def get_progress(stderr_line: str, total_duration: float) -> float | None:
    """Parse FFmpeg progress from stderr output (used for real-time progress tracking)."""
    if "time=" not in stderr_line:
        return None
    try:
        time_str = stderr_line.split("time=")[1].split(" ")[0]
        parts = time_str.split(":")
        current = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        return min(current / total_duration, 1.0) if total_duration > 0 else 0.0
    except (IndexError, ValueError):
        return None


BROWSER_CODECS = {"h264", "vp8", "vp9", "av1", "theora"}
BROWSER_EXTENSIONS = {".mp4", ".webm", ".ogg", ".ogv"}


def needs_preview(file_path: Path) -> bool:
    """Check if the video needs transcoding for browser playback (codec + container)."""
    ext = file_path.suffix.lower()
    if ext not in BROWSER_EXTENSIONS:
        return True
    info = probe(file_path)
    return info.codec.lower() not in BROWSER_CODECS


def create_preview(input_path: Path, output_path: Path, max_height: int = 720) -> Path:
    """Transcode to H.264 MP4 that any browser can play. Capped at max_height for speed."""
    info = probe(input_path)

    stream = ffmpeg.input(str(input_path))
    if info.height > max_height:
        stream = stream.filter("scale", -2, f"min({max_height},ih)")

    (
        stream.output(
            str(output_path),
            vcodec="libx264",
            acodec="aac",
            preset="fast",
            crf=28,
            movflags="+faststart",
            format="mp4",
        )
        .overwrite_output()
        .run(cmd=settings.ffmpeg_path, capture_stdout=True, capture_stderr=True)
    )
    return output_path


def generate_thumbnail(input_path: Path, output_path: Path, timestamp: float = 1.0) -> Path:
    """Extract a single frame as a JPEG thumbnail."""
    (
        ffmpeg.input(str(input_path), ss=timestamp)
        .output(str(output_path), vframes=1, format="image2", vcodec="mjpeg")
        .overwrite_output()
        .run(cmd=settings.ffmpeg_path, capture_stdout=True, capture_stderr=True)
    )
    return output_path
