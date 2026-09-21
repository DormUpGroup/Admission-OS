from datetime import datetime

from pydantic import BaseModel


class TaskStudent(BaseModel):
    id: str
    first_name: str
    last_name: str


class TaskSummary(BaseModel):
    id: str
    title: str
    description: str | None
    status: str
    priority: str
    student_id: str
    application_id: str | None
    due_date: datetime | None
    student: TaskStudent


class CreateTaskRequest(BaseModel):
    title: str
    student_id: str
    description: str | None = None
    application_id: str | None = None
    due_date: datetime | None = None
    priority: str = "MEDIUM"
    is_student_facing: bool = False
