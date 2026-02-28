import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

interface Props {
  src: string;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onSegmentEnd?: () => void;
  onUserInteraction?: () => void;
}

export interface VideoPlayerHandle {
  seek: (time: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  play: () => void;
  pause: () => void;
  playSegment: (start: number, end: number) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(
  ({ src, onTimeUpdate, onDurationChange, onSegmentEnd, onUserInteraction }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const segEndRef = useRef<number | null>(null);
    const rafRef = useRef<number>(0);
    const seekCleanupRef = useRef<(() => void) | null>(null);
    const programmaticRef = useRef(false);
    const programmaticTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const onSegmentEndRef = useRef(onSegmentEnd);
    onSegmentEndRef.current = onSegmentEnd;
    const onUserInteractionRef = useRef(onUserInteraction);
    onUserInteractionRef.current = onUserInteraction;
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const markProgrammatic = () => {
      programmaticRef.current = true;
      clearTimeout(programmaticTimer.current);
      programmaticTimer.current = setTimeout(() => {
        programmaticRef.current = false;
      }, 120);
    };

    const stopSegmentLoop = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (seekCleanupRef.current) {
        seekCleanupRef.current();
        seekCleanupRef.current = null;
      }
      segEndRef.current = null;
    };

    const startSegmentLoop = () => {
      const tick = () => {
        const v = videoRef.current;
        if (!v || segEndRef.current === null) return;
        if (v.currentTime >= segEndRef.current) {
          markProgrammatic();
          v.pause();
          v.currentTime = segEndRef.current;
          stopSegmentLoop();
          onSegmentEndRef.current?.();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    useImperativeHandle(ref, () => ({
      seek: (t: number) => {
        if (videoRef.current) {
          markProgrammatic();
          videoRef.current.currentTime = t;
        }
      },
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      getDuration: () => videoRef.current?.duration ?? 0,
      play: () => {
        stopSegmentLoop();
        markProgrammatic();
        videoRef.current?.play().catch(() => {});
      },
      pause: () => {
        stopSegmentLoop();
        markProgrammatic();
        videoRef.current?.pause();
      },
      playSegment: (start: number, end: number) => {
        const v = videoRef.current;
        if (!v) return;
        stopSegmentLoop();
        markProgrammatic();
        segEndRef.current = end;
        v.currentTime = start;

        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          seekCleanupRef.current = null;
          markProgrammatic();
          v.play().catch(() => {});
          startSegmentLoop();
        };
        seekCleanupRef.current = () => v.removeEventListener("seeked", onSeeked);
        v.addEventListener("seeked", onSeeked, { once: true });
      },
    }));

    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;

      const handleUserAction = () => {
        if (programmaticRef.current) return;
        stopSegmentLoop();
        onUserInteractionRef.current?.();
      };

      const onTime = () => {
        setCurrentTime(v.currentTime);
        onTimeUpdate?.(v.currentTime);
      };
      const onDur = () => {
        if (!isNaN(v.duration)) {
          setDuration(v.duration);
          onDurationChange?.(v.duration);
        }
      };
      const onPlay = () => {
        setPlaying(true);
        handleUserAction();
      };
      const onPause = () => {
        setPlaying(false);
        handleUserAction();
      };
      const onSeeking = () => {
        handleUserAction();
      };
      const onError = () => {
        const e = v.error;
        setError(e ? `Error ${e.code}: ${e.message}` : "Unknown video error");
      };

      v.addEventListener("timeupdate", onTime);
      v.addEventListener("durationchange", onDur);
      v.addEventListener("play", onPlay);
      v.addEventListener("pause", onPause);
      v.addEventListener("seeking", onSeeking);
      v.addEventListener("error", onError);

      return () => {
        v.removeEventListener("timeupdate", onTime);
        v.removeEventListener("durationchange", onDur);
        v.removeEventListener("play", onPlay);
        v.removeEventListener("pause", onPause);
        v.removeEventListener("seeking", onSeeking);
        v.removeEventListener("error", onError);
        stopSegmentLoop();
        clearTimeout(programmaticTimer.current);
      };
    }, [onTimeUpdate, onDurationChange]);

    const formatTime = (s: number) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      const ms = Math.floor((s % 1) * 100);
      return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
    };

    return (
      <div className="video-player">
        {error && <div className="video-error">{error}</div>}
        <video
          ref={videoRef}
          src={src || undefined}
          controls
          preload="auto"
          className="video-element"
        />
        <div className="video-controls">
          <span className="time-display">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>
    );
  },
);
