import json
import logging
from typing import List, Optional
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field

from ..tools.pdf_tools import extract_text_with_layout
from ..services.graph_store import upsert_graph_nodes, upsert_graph_edges, GraphNodeInsert, GraphEdgeInsert
from ..config import get_settings

logger = logging.getLogger(__name__)

class ScheduleEvent(BaseModel):
    course_code: str = Field(description="Course code e.g. CS101")
    course_name: str = Field(description="Full course name")
    professor: Optional[str] = Field(description="Professor name")
    location: Optional[str] = Field(description="Room e.g. 304")
    day_of_week: str = Field(description="Monday, Tuesday etc.")
    start_time: str = Field(description="HH:MM AM/PM")
    end_time: str = Field(description="HH:MM AM/PM")

class ScheduleExtraction(BaseModel):
    events: List[ScheduleEvent]

async def ingest_schedule_pdf(user_id: str, file_path: str) -> str:
    settings = get_settings()
    if not settings.openai_api_key:
        return "Error: OpenAI API key missing."
    
    text = extract_text_with_layout(file_path)
    if not text or len(text) < 50:
        return "Error: Could not extract sufficient text from PDF."

    llm = ChatOpenAI(
        api_key=settings.openai_api_key,
        model_name="gpt-4o", # Use smart model for complex parsing
        temperature=0
    )

    parser = JsonOutputParser(pydantic_object=ScheduleExtraction)

    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a data extraction assistant. Your job is to extract a weekly class schedule from the provided text. The text is from a PDF and may have layout artifacts. Use your reasoning to reconstruct the table rows.\n\n{format_instructions}"),
        ("human", "Extract the schedule from this text:\n\n{text}")
    ]).partial(format_instructions=parser.get_format_instructions())

    chain = prompt | llm | parser

    try:
        result = await chain.ainvoke({"text": text})
        data = ScheduleExtraction(**result)
        
        nodes: List[GraphNodeInsert] = []
        edges: List[GraphEdgeInsert] = []

        for event in data.events:
            # entities: Course, Person (Professor), Location, TimeSlot?
            # Ideally we link TimeSlot to Course.
            
            # Course Node
            course_id = f"course:{event.course_code}"
            nodes.append(GraphNodeInsert(
                id=course_id,
                type="Course",
                properties={"name": event.course_name, "code": event.course_code},
                user_id=user_id
            ))

            # Professor Node
            if event.professor:
                prof_id = f"person:{event.professor.replace(' ', '_')}"
                nodes.append(GraphNodeInsert(
                    id=prof_id,
                    type="Person",
                    properties={"name": event.professor},
                    user_id=user_id
                ))
                edges.append(GraphEdgeInsert(
                    source_id=course_id,
                    target_id=prof_id,
                    type="taught_by",
                    properties={},
                    user_id=user_id
                ))

            # Location Node
            if event.location:
                loc_id = f"loc:{event.location.replace(' ', '_')}"
                nodes.append(GraphNodeInsert(
                    id=loc_id,
                    type="Location",
                    properties={"name": event.location},
                    user_id=user_id
                ))
                edges.append(GraphEdgeInsert(
                    source_id=course_id,
                    target_id=loc_id,
                    type="located_at", # Semantic choice
                    properties={},
                    user_id=user_id
                ))

            # For the schedule itself, we can create a "ClassSession" node or "TimeSlot"
            # Node: ClassSession
            session_id = f"session:{event.course_code}:{event.day_of_week}:{event.start_time}"
            nodes.append(GraphNodeInsert(
                id=session_id,
                type="ClassSession",
                properties={
                    "day": event.day_of_week, 
                    "start": event.start_time, 
                    "end": event.end_time
                },
                user_id=user_id
            ))
            
            # Edge: Course -> ClassSession
            edges.append(GraphEdgeInsert(
                source_id=course_id,
                target_id=session_id,
                type="has_session",
                properties={},
                user_id=user_id
            ))

        if nodes:
            await upsert_graph_nodes(nodes)
        if edges:
            await upsert_graph_edges(edges)
            
        return f"Successfully extracted and graphed {len(data.events)} classes."

    except Exception as e:
        logger.error(f"Schedule extraction failed: {e}")
        return f"Failed to extract schedule: {str(e)}"
