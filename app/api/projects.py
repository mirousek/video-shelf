from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    Project,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
)
from app.services import projectstore

router = APIRouter()


def _to_response(p: Project) -> ProjectResponse:
    return ProjectResponse(
        id=p.id,
        name=p.name,
        videos=p.videos,
        output_timeline=p.output_timeline,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.post("/projects", response_model=ProjectResponse)
async def create_project(req: ProjectCreate):
    project = Project(
        name=req.name,
        videos=req.videos,
        output_timeline=req.output_timeline,
    )
    projectstore.save_project(project)
    return _to_response(project)


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects():
    return [_to_response(p) for p in projectstore.list_projects()]


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str):
    project = projectstore.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _to_response(project)


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, req: ProjectUpdate):
    project = projectstore.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    if req.name is not None:
        project.name = req.name
    if req.videos is not None:
        project.videos = req.videos
    if req.output_timeline is not None:
        project.output_timeline = req.output_timeline

    projectstore.save_project(project)
    return _to_response(project)


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    if not projectstore.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}
