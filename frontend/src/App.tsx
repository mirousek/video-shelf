import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { UploadZone, type UploadProgress } from "./components/UploadZone";
import { VideoPlayer, type VideoPlayerHandle } from "./components/VideoPlayer";
import { Timeline } from "./components/Timeline";
import { SegmentList } from "./components/SegmentList";
import { ExportPanel } from "./components/ExportPanel";
import { ProjectList } from "./components/ProjectList";
import { VideoList } from "./components/VideoList";
import { OutputTimeline } from "./components/OutputTimeline";
import { ImageTimeline } from "./components/ImageTimeline";
import { createProject, getVideoStreamUrl, updateProject, uploadVideo } from "./services/api";
import { useAutoSave } from "./hooks/useAutoSave";
import type { Clip, CutSegment, ProjectResponse, ProjectVideo } from "./types/api";

type View = "projects" | "upload" | "editor";

type UndoEntry =
  | { type: "video-delete"; index: number; video: ProjectVideo; removedClips: { idx: number; clip: Clip }[] }
  | { type: "segment-delete"; videoIndex: number; segIndex: number; segment: CutSegment; removedClip: { idx: number; clip: Clip } | null }
  | { type: "segment-resize"; videoIndex: number; segIndex: number; oldSegment: CutSegment; oldTimeline: Clip[] };

const UNDO_LIMIT = 50;

export default function App() {
  const [view, setView] = useState<View>("projects");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [addingVideos, setAddingVideos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectListKey, setProjectListKey] = useState(0);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [videos, setVideos] = useState<ProjectVideo[]>([]);
  const videosRef = useRef<ProjectVideo[]>(videos);
  const [outputTimeline, setOutputTimeline] = useState<Clip[]>([]);
  const outputTimelineRef = useRef<Clip[]>(outputTimeline);
  const [activeIndex, setActiveIndex] = useState(0);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [playingClipIndex, setPlayingClipIndex] = useState<number | null>(null);
  const [focusedClipIndex, setFocusedClipIndex] = useState<number | null>(null);
  const [playingSeg, setPlayingSeg] = useState<{ vi: number; si: number } | null>(null);
  const pendingPlayRef = useRef<Clip | null>(null);
  const photoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [photoPlayback, setPhotoPlayback] = useState<{ startTime: number; duration: number } | null>(null);
  const handleSegmentEndRef = useRef<(() => void) | null>(null);

  const playerRef = useRef<VideoPlayerHandle>(null);

  const undoStackRef = useRef<UndoEntry[]>([]);
  const pushUndo = useCallback((entry: UndoEntry) => {
    undoStackRef.current = [...undoStackRef.current.slice(-(UNDO_LIMIT - 1)), entry];
  }, []);

  const resizeDragRef = useRef<{ videoIndex: number; segIndex: number; oldSegment: CutSegment; oldTimeline: Clip[] } | null>(null);

  useAutoSave(projectId, videos, outputTimeline);

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);

    switch (entry.type) {
      case "video-delete": {
        setVideos((v) => {
          const copy = [...v];
          copy.splice(entry.index, 0, entry.video);
          return copy;
        });
        setOutputTimeline((ot) => {
          const copy = [...ot];
          for (const { idx, clip } of entry.removedClips) {
            copy.splice(idx, 0, clip);
          }
          return copy;
        });
        setActiveIndex(entry.index);
        break;
      }
      case "segment-delete": {
        setVideos((v) =>
          v.map((vid, vi) =>
            vi === entry.videoIndex
              ? { ...vid, segments: [...vid.segments.slice(0, entry.segIndex), entry.segment, ...vid.segments.slice(entry.segIndex)] }
              : vid,
          ),
        );
        if (entry.removedClip) {
          const { idx, clip } = entry.removedClip;
          setOutputTimeline((ot) => {
            const copy = [...ot];
            copy.splice(idx, 0, clip);
            return copy;
          });
        }
        break;
      }
      case "segment-resize": {
        const updated = videosRef.current.map((vid, vi) =>
          vi === entry.videoIndex
            ? { ...vid, segments: vid.segments.map((s, si) => (si === entry.segIndex ? entry.oldSegment : s)) }
            : vid,
        );
        videosRef.current = updated;
        setVideos(updated);
        setOutputTimeline(entry.oldTimeline);
        playerRef.current?.seek(entry.oldSegment.start);
        break;
      }
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo]);

  videosRef.current = videos;
  outputTimelineRef.current = outputTimeline;
  const activeVideo = videos[activeIndex] ?? null;
  const isActiveImage = activeVideo?.video_info.media_type === "image";
  const videoSrc = activeVideo ? getVideoStreamUrl(activeVideo.video_id) : "";

  const clearPhotoTimer = () => {
    if (photoTimerRef.current) {
      clearTimeout(photoTimerRef.current);
      photoTimerRef.current = null;
    }
    setPhotoPlayback(null);
  };

  const resetEditor = () => {
    clearPhotoTimer();
    setProjectId(null);
    setProjectName("");
    setVideos([]);
    setOutputTimeline([]);
    setActiveIndex(0);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setPlayingSeg(null);
  };

  const handleBackToProjects = () => {
    resetEditor();
    setProjectListKey((k) => k + 1);
    setView("projects");
  };

  const uploadFiles = async (files: File[]): Promise<ProjectVideo[]> => {
    const results: ProjectVideo[] = [];
    for (const file of files) {
      const res = await uploadVideo(file);
      results.push({
        video_id: res.video_id,
        video_info: res.info,
        segments: [],
      });
    }
    return results;
  };

  const handleUpload = useCallback(async (files: File[]) => {
    setError(null);
    setUploading(true);
    setUploadProgress(files.map((f) => ({ name: f.name, done: false })));

    const uploaded: ProjectVideo[] = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const res = await uploadVideo(files[i]);
        uploaded.push({
          video_id: res.video_id,
          video_info: res.info,
          segments: [],
        });
        setUploadProgress((prev) =>
          prev.map((p, j) => (j === i ? { ...p, done: true } : p)),
        );
      } catch (e: any) {
        setUploadProgress((prev) =>
          prev.map((p, j) => (j === i ? { ...p, done: true, error: e.message } : p)),
        );
      }
    }

    setUploading(false);
    setUploadProgress([]);

    if (uploaded.length === 0) return;

    try {
      const name = files.length === 1
        ? files[0].name.replace(/\.[^.]+$/, "")
        : `Project (${files.length} files)`;

      const project = await createProject({ name, videos: uploaded });

      setProjectId(project.id);
      setProjectName(project.name);
      setVideos(project.videos);
      setOutputTimeline(project.output_timeline ?? []);
      setActiveIndex(0);
      setDuration(project.videos[0]?.video_info.duration ?? 0);
      setView("editor");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const handleAddVideos = useCallback(async (files: File[]) => {
    setAddingVideos(true);
    try {
      const newVideos = await uploadFiles(files);
      setVideos((prev) => [...prev, ...newVideos]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAddingVideos(false);
    }
  }, []);

  const handleRemoveVideo = useCallback((index: number) => {
    const removedVideo = videosRef.current[index];
    if (!removedVideo) return;
    const ot = outputTimelineRef.current;
    const removedClips: { idx: number; clip: Clip }[] = [];
    ot.forEach((c, i) => { if (c.video_id === removedVideo.video_id) removedClips.push({ idx: i, clip: c }); });
    pushUndo({ type: "video-delete", index, video: removedVideo, removedClips });
    setOutputTimeline((prev) => prev.filter((c) => c.video_id !== removedVideo.video_id));
    setVideos((prev) => prev.filter((_, i) => i !== index));
    setActiveIndex((prev) => {
      if (index < prev) return prev - 1;
      if (index === prev) return Math.min(prev, videosRef.current.length - 2);
      return prev;
    });
  }, [pushUndo]);

  const handleSelectVideo = useCallback((index: number) => {
    setActiveIndex(index);
    setCurrentTime(0);
    const vid = videosRef.current[index];
    if (vid && vid.video_info.media_type !== "image") {
      if (index === activeIndex) {
        playerRef.current?.seek(0);
        playerRef.current?.play();
      } else {
        setTimeout(() => {
          playerRef.current?.seek(0);
          playerRef.current?.play();
        }, 300);
      }
    }
  }, [activeIndex]);

  const handleOpenProject = useCallback((project: ProjectResponse) => {
    const migratedVideos = project.videos.map((v) => ({
      ...v,
      segments: v.segments.map((s) => (s.id ? s : { ...s, id: crypto.randomUUID() })),
    }));
    const ot = (project.output_timeline ?? []).map((clip) => {
      if (clip.segment_id || clip.photo_duration != null) return clip;
      const video = migratedVideos.find((v) => v.video_id === clip.video_id);
      const seg = video?.segments.find((s) => s.start === clip.start && s.end === clip.end);
      return seg ? { ...clip, segment_id: seg.id } : clip;
    });

    setProjectId(project.id);
    setProjectName(project.name);
    setVideos(migratedVideos);
    setOutputTimeline(ot);
    setActiveIndex(0);
    setDuration(project.videos[0]?.video_info.duration ?? 0);
    setError(null);
    setView("editor");
  }, []);

  const handlePlayerInteraction = useCallback(() => {
    clearPhotoTimer();
    setPlayingClipIndex(null);
    setFocusedClipIndex(null);
    setPlayingSeg(null);
    pendingPlayRef.current = null;
  }, []);

  const handleFullClear = useCallback(() => {
    clearPhotoTimer();
    flushSync(() => {
      setPlayingClipIndex(null);
      setFocusedClipIndex(null);
      setPlayingSeg(null);
    });
    pendingPlayRef.current = null;
    playerRef.current?.pause();
  }, []);

  const handleSeek = useCallback((time: number) => {
    clearPhotoTimer();
    if (playingClipIndex !== null) {
      setFocusedClipIndex(playingClipIndex);
      setPlayingClipIndex(null);
    }
    setPlayingSeg(null);
    pendingPlayRef.current = null;
    playerRef.current?.pause();
    playerRef.current?.seek(time);
  }, [playingClipIndex]);

  const handleSegmentAdd = useCallback((seg: CutSegment) => {
    const videoId = videos[activeIndex]?.video_id;
    if (videoId) {
      setOutputTimeline((ot) => [
        ...ot,
        { video_id: videoId, start: seg.start, end: seg.end, segment_id: seg.id },
      ]);
    }
    setVideos((prev) =>
      prev.map((v, i) =>
        i === activeIndex ? { ...v, segments: [...v.segments, seg] } : v,
      ),
    );
  }, [activeIndex, videos]);

  const handleSegmentRemove = useCallback((videoIndex: number, segIndex: number) => {
    const video = videosRef.current[videoIndex];
    if (!video) return;
    const seg = video.segments[segIndex];
    if (!seg) return;

    const ot = outputTimelineRef.current;
    const clipIdx = seg.id
      ? ot.findIndex((c) => c.segment_id === seg.id)
      : ot.findIndex((c) => c.video_id === video.video_id && c.start === seg.start && c.end === seg.end);
    const removedClip = clipIdx >= 0 ? { idx: clipIdx, clip: ot[clipIdx] } : null;
    pushUndo({ type: "segment-delete", videoIndex, segIndex, segment: seg, removedClip });

    if (clipIdx >= 0) {
      setOutputTimeline((prev) => prev.filter((_, i) => i !== clipIdx));
    }
    setVideos((prev) =>
      prev.map((v, i) =>
        i === videoIndex
          ? { ...v, segments: v.segments.filter((_, j) => j !== segIndex) }
          : v,
      ),
    );
  }, [pushUndo]);

  const handlePreview = useCallback((videoIndex: number, segIndex: number) => {
    setPlayingClipIndex(null);
    pendingPlayRef.current = null;
    const video = videos[videoIndex];
    const seg = video?.segments[segIndex];
    if (!video || !seg) return;
    const clipIdx = seg.id
      ? outputTimeline.findIndex((c) => c.segment_id === seg.id)
      : outputTimeline.findIndex((c) => c.video_id === video.video_id && c.start === seg.start && c.end === seg.end);
    setFocusedClipIndex(clipIdx >= 0 ? clipIdx : null);
    setPlayingSeg({ vi: videoIndex, si: segIndex });
    if (videoIndex !== activeIndex) {
      setActiveIndex(videoIndex);
      setCurrentTime(0);
      setTimeout(() => {
        playerRef.current?.playSegment(seg.start, seg.end);
      }, 300);
    } else {
      playerRef.current?.playSegment(seg.start, seg.end);
    }
  }, [activeIndex, videos, outputTimeline]);

  const handleSegmentUpdate = useCallback((videoIndex: number, segIndex: number, seg: CutSegment, edge?: "start" | "end") => {
    const video = videosRef.current[videoIndex];
    if (video) {
      const oldSeg = video.segments[segIndex];
      if (oldSeg) {
        setOutputTimeline((ot) =>
          ot.map((c) =>
            (oldSeg.id && c.segment_id === oldSeg.id) ||
            (!oldSeg.id && c.video_id === video.video_id && c.start === oldSeg.start && c.end === oldSeg.end)
              ? { ...c, start: seg.start, end: seg.end }
              : c,
          ),
        );

        if (edge) {
          clearPhotoTimer();
          setPlayingClipIndex(null);
          setFocusedClipIndex(null);
          setPlayingSeg(null);
          pendingPlayRef.current = null;
          playerRef.current?.pause();

          const seekTo = edge === "start" ? seg.start : seg.end;
          if (videoIndex === activeIndex) {
            playerRef.current?.seek(seekTo);
          } else {
            setActiveIndex(videoIndex);
            setTimeout(() => playerRef.current?.seek(seekTo), 300);
          }
        }
      }
    }
    const updated = videosRef.current.map((v, i) =>
      i === videoIndex
        ? { ...v, segments: v.segments.map((s, j) => (j === segIndex ? seg : s)) }
        : v,
    );
    videosRef.current = updated;
    setVideos(updated);
  }, [activeIndex]);

  const playClipAtIndex = useCallback((idx: number, fromTime?: number) => {
    clearPhotoTimer();
    const clip = outputTimeline[idx];
    if (!clip) {
      setPlayingClipIndex(null);
      return;
    }
    const vi = videos.findIndex((v) => v.video_id === clip.video_id);
    if (vi < 0) {
      setPlayingClipIndex(null);
      return;
    }
    setPlayingClipIndex(idx);
    setFocusedClipIndex(null);
    const si = clip.segment_id
      ? videos[vi].segments.findIndex((s) => s.id === clip.segment_id)
      : videos[vi].segments.findIndex((s) => s.start === clip.start && s.end === clip.end);
    setPlayingSeg(si >= 0 ? { vi, si } : null);

    if (clip.photo_duration != null) {
      if (vi !== activeIndex) setActiveIndex(vi);
      pendingPlayRef.current = null;
      const offset = fromTime ?? 0;
      const dur = clip.photo_duration - offset;
      setPhotoPlayback({ startTime: performance.now() - offset * 1000, duration: clip.photo_duration });

      photoTimerRef.current = setTimeout(() => {
        photoTimerRef.current = null;
        setPhotoPlayback(null);
        handleSegmentEndRef.current?.();
      }, dur * 1000);
      return;
    }

    const startAt = fromTime ?? clip.start;
    if (vi !== activeIndex) {
      pendingPlayRef.current = { ...clip, start: startAt };
      setActiveIndex(vi);
    } else {
      pendingPlayRef.current = null;
      playerRef.current?.playSegment(startAt, clip.end);
    }
  }, [outputTimeline, videos, activeIndex]);

  useEffect(() => {
    if (pendingPlayRef.current && playerRef.current) {
      const clip = pendingPlayRef.current;
      pendingPlayRef.current = null;
      setTimeout(() => {
        playerRef.current?.playSegment(clip.start, clip.end);
      }, 300);
    }
  }, [activeIndex]);

  const handleSegmentEnd = useCallback(() => {
    if (playingClipIndex === null) return;
    const nextIdx = playingClipIndex + 1;
    if (nextIdx < outputTimeline.length) {
      playClipAtIndex(nextIdx);
    } else {
      setFocusedClipIndex(playingClipIndex);
      setPlayingClipIndex(null);
    }
  }, [playingClipIndex, outputTimeline.length, playClipAtIndex]);

  handleSegmentEndRef.current = handleSegmentEnd;

  const handlePlayAll = useCallback(() => {
    if (outputTimeline.length === 0) return;
    playClipAtIndex(0);
  }, [outputTimeline.length, playClipAtIndex]);

  const handleStopPlayback = useCallback(() => {
    clearPhotoTimer();
    setFocusedClipIndex(playingClipIndex);
    setPlayingClipIndex(null);
    pendingPlayRef.current = null;
    playerRef.current?.pause();
  }, [playingClipIndex]);

  const playSingleClip = useCallback((clipIndex: number, fromTime?: number) => {
    clearPhotoTimer();
    const clip = outputTimeline[clipIndex];
    if (!clip) return;
    const vi = videos.findIndex((v) => v.video_id === clip.video_id);
    if (vi < 0) return;
    setPlayingClipIndex(null);
    setFocusedClipIndex(clipIndex);
    const si = clip.segment_id
      ? videos[vi].segments.findIndex((s) => s.id === clip.segment_id)
      : videos[vi].segments.findIndex((s) => s.start === clip.start && s.end === clip.end);
    setPlayingSeg(si >= 0 ? { vi, si } : null);
    pendingPlayRef.current = null;

    if (clip.photo_duration != null) {
      if (vi !== activeIndex) setActiveIndex(vi);
      const offset = fromTime ?? 0;
      const dur = clip.photo_duration - offset;
      setPhotoPlayback({ startTime: performance.now() - offset * 1000, duration: clip.photo_duration });

      photoTimerRef.current = setTimeout(() => {
        photoTimerRef.current = null;
        setPhotoPlayback(null);
        setFocusedClipIndex(clipIndex);
        setPlayingSeg(null);
      }, dur * 1000);
      return;
    }

    const startAt = fromTime ?? clip.start;
    if (vi !== activeIndex) {
      pendingPlayRef.current = { ...clip, start: startAt };
      setActiveIndex(vi);
    } else {
      playerRef.current?.playSegment(startAt, clip.end);
    }
  }, [outputTimeline, videos, activeIndex]);

  const handleTimelineSeek = useCallback((clipIndex: number, time: number) => {
    if (playingClipIndex !== null) {
      playClipAtIndex(clipIndex, time);
    } else {
      playSingleClip(clipIndex, time);
    }
  }, [playingClipIndex, playClipAtIndex, playSingleClip]);

  const handleTimelineReorder = useCallback((newTimeline: Clip[]) => {
    setOutputTimeline(newTimeline);
  }, []);

  const handleTimelinePreview = useCallback((clipIndex: number) => {
    if (playingClipIndex !== null) {
      playClipAtIndex(clipIndex);
    } else {
      playSingleClip(clipIndex);
    }
  }, [playingClipIndex, playClipAtIndex, playSingleClip]);

  const handleTimelineRemove = useCallback((clipIndex: number) => {
    setOutputTimeline((prev) => prev.filter((_, i) => i !== clipIndex));
  }, []);

  const handleAddToTimeline = useCallback((videoIndex: number, segIndex: number) => {
    const video = videos[videoIndex];
    if (!video) return;
    const seg = video.segments[segIndex];
    if (!seg) return;
    setOutputTimeline((ot) => [
      ...ot,
      { video_id: video.video_id, start: seg.start, end: seg.end, segment_id: seg.id },
    ]);
  }, [videos]);

  const handleAddPhotoToTimeline = useCallback((videoIndex: number) => {
    const video = videos[videoIndex];
    if (!video || video.video_info.media_type !== "image") return;
    const defaultDuration = 5;
    setOutputTimeline((ot) => [
      ...ot,
      { video_id: video.video_id, start: 0, end: defaultDuration, photo_duration: defaultDuration, segment_id: null },
    ]);
  }, [videos]);

  const handleClipDurationChange = useCallback((clipIndex: number, newDuration: number) => {
    setOutputTimeline((ot) =>
      ot.map((c, i) =>
        i === clipIndex && c.photo_duration != null
          ? { ...c, end: newDuration, photo_duration: newDuration }
          : c,
      ),
    );
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1 onClick={handleBackToProjects} style={{ cursor: "pointer" }}>
          VideoShelf
        </h1>
        {view === "editor" && (
          <>
            <button className="btn-back" onClick={handleBackToProjects}>
              Projects
            </button>
            <span
              className="project-name"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={(e) => {
                const name = e.currentTarget.textContent?.trim() || projectName;
                if (name !== projectName) {
                  setProjectName(name);
                  if (projectId) updateProject(projectId, { name }).catch(() => {});
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                if (e.key === "Escape") { e.currentTarget.textContent = projectName; e.currentTarget.blur(); }
              }}
            >
              {projectName}
            </span>
          </>
        )}
        {activeVideo && (
          <span className="video-meta">
            {activeVideo.video_info.width}&times;{activeVideo.video_info.height}
            {isActiveImage
              ? ` · ${(activeVideo.video_info.size_bytes / 1024 / 1024).toFixed(1)}MB · Image`
              : ` · ${activeVideo.video_info.codec} · ${activeVideo.video_info.fps}fps · ${(activeVideo.video_info.size_bytes / 1024 / 1024).toFixed(1)}MB`}
          </span>
        )}
      </header>

      <main className="app-main">
        {error && <p className="error-text">{error}</p>}

        {view === "projects" && (
          <ProjectList
            onOpen={handleOpenProject}
            onNew={() => setView("upload")}
            refreshKey={projectListKey}
          />
        )}

        {view === "upload" && (
          <div className="upload-view">
            <UploadZone onFiles={handleUpload} loading={uploading} progress={uploadProgress} />
          </div>
        )}

        {view === "editor" && (
          <div className="editor-view">
            <div className="editor-with-sidebar">
              <VideoList
                videos={videos}
                activeIndex={activeIndex}
                onSelect={handleSelectVideo}
                onRemove={handleRemoveVideo}
                onAddFiles={handleAddVideos}
                onAddPhotoToTimeline={handleAddPhotoToTimeline}
                uploading={addingVideos}
              />
              <div className="editor-main">
                <div className="editor-top">
                  {activeVideo && isActiveImage ? (
                    <div className="photo-preview">
                      <img
                        src={getVideoStreamUrl(activeVideo.video_id)}
                        alt={activeVideo.video_info.filename}
                        className="photo-preview-img"
                      />
                      <div className="photo-preview-info">
                        {activeVideo.video_info.width}&times;{activeVideo.video_info.height}
                      </div>
                    </div>
                  ) : activeVideo ? (
                    <VideoPlayer
                      key={activeVideo.video_id}
                      ref={playerRef}
                      src={videoSrc}
                      onTimeUpdate={setCurrentTime}
                      onDurationChange={setDuration}
                      onSegmentEnd={handleSegmentEnd}
                      onUserInteraction={handlePlayerInteraction}
                    />
                  ) : null}
                </div>

                {activeVideo && (isActiveImage ? (
                  <ImageTimeline
                    duration={outputTimeline.find((c) => c.video_id === activeVideo.video_id)?.photo_duration ?? 5}
                    videoIndex={activeIndex}
                    active={
                      photoPlayback !== null ||
                      (focusedClipIndex !== null && outputTimeline[focusedClipIndex]?.video_id === activeVideo.video_id && outputTimeline[focusedClipIndex]?.photo_duration != null)
                    }
                    photoPlayback={photoPlayback}
                  />
                ) : (
                  <Timeline
                    duration={duration}
                    currentTime={currentTime}
                    segments={activeVideo.segments}
                    videoIndex={activeIndex}
                    highlightSegIndex={playingSeg?.vi === activeIndex ? playingSeg.si : null}
                    onSeek={handleSeek}
                    onSegmentAdd={handleSegmentAdd}
                    onSegmentRemove={(si) => handleSegmentRemove(activeIndex, si)}
                    onSegmentUpdate={(si, seg, edge) => handleSegmentUpdate(activeIndex, si, seg, edge)}
                    onResizeStart={(si) => {
                      const seg = videosRef.current[activeIndex]?.segments[si];
                      if (seg) resizeDragRef.current = { videoIndex: activeIndex, segIndex: si, oldSegment: { ...seg }, oldTimeline: [...outputTimeline] };
                    }}
                    onResizeEnd={(si) => {
                      const snap = resizeDragRef.current;
                      if (snap && snap.videoIndex === activeIndex && snap.segIndex === si) {
                        const cur = videosRef.current[activeIndex]?.segments[si];
                        if (cur && (cur.start !== snap.oldSegment.start || cur.end !== snap.oldSegment.end)) {
                          pushUndo({ type: "segment-resize", videoIndex: snap.videoIndex, segIndex: snap.segIndex, oldSegment: snap.oldSegment, oldTimeline: snap.oldTimeline });
                        }
                      }
                      resizeDragRef.current = null;
                    }}
                  />
                ))}

                <OutputTimeline
                  clips={outputTimeline}
                  videos={videos}
                  playingIndex={playingClipIndex}
                  focusedIndex={focusedClipIndex}
                  currentTime={currentTime}
                  photoPlayback={photoPlayback}
                  activeVideoId={activeVideo?.video_id ?? null}
                  onReorder={handleTimelineReorder}
                  onSeek={handleTimelineSeek}
                  onPreview={handleTimelinePreview}
                  onRemove={handleTimelineRemove}
                  onPlayAll={handlePlayAll}
                  onStop={handleStopPlayback}
                  onDragStart={handleFullClear}
                  onClipDurationChange={handleClipDurationChange}
                />

                <div className="editor-bottom">
                  <SegmentList
                    videos={videos}
                    activeIndex={activeIndex}
                    highlightVi={playingSeg?.vi ?? null}
                    highlightSi={playingSeg?.si ?? null}
                    onSelect={handleSelectVideo}
                    onRemove={handleSegmentRemove}
                    onUpdate={handleSegmentUpdate}
                    onPreview={handlePreview}
                    onAddToTimeline={handleAddToTimeline}
                  />
                  <ExportPanel videos={videos} outputTimeline={outputTimeline} projectId={projectId} />
                </div>
              </div>
            </div>
      </div>
        )}
      </main>
      </div>
  );
}
